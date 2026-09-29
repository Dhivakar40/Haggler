import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EnvService } from '../config/env.service';

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const hmacHex = (secret: string, value: string): string =>
  createHmac('sha256', secret).update(value).digest('hex');

const HEX_RE = /^[0-9a-f]+$/i;

export function safeEqualHex(a: string, b: string): boolean {
  // Buffer.from(str, 'hex') silently stops at the first byte it cannot decode instead of
  // throwing (e.g. Buffer.from('deadbeefx', 'hex') is just `deadbeef`), so a tampered value with
  // trailing garbage can otherwise come out the same length and falsely compare equal. Reject
  // anything that is not pure, even-length hex before ever comparing bytes.
  if (a.length !== b.length || a.length % 2 !== 0 || !HEX_RE.test(a) || !HEX_RE.test(b))
    return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Field-level encryption for the most sensitive values (date of birth, Aadhaar last 4).
 * AES-256-GCM: confidentiality + tamper detection. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 * A fresh random 12-byte IV per value means the same plaintext encrypts differently each time.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(env: EnvService) {
    this.key = Buffer.from(env.env.FIELD_ENCRYPTION_KEY, 'base64');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      ct.toString('base64url'),
    ].join('.');
  }

  /** Throws if the value was modified or the key is wrong. */
  decrypt(payload: string): string {
    const [version, iv, tag, ct] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

// ---- Passwords (admin accounts): scrypt with a per-user salt ---------------------------

const SCRYPT_N = 16384;

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, { N: SCRYPT_N, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32);
  return `scrypt$${SCRYPT_N}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || Number(n) !== SCRYPT_N || !salt || !hash) return false;
  const key = await scryptAsync(password, Buffer.from(salt, 'base64url'), 32);
  const expected = Buffer.from(hash, 'base64url');
  return key.length === expected.length && timingSafeEqual(key, expected);
}
