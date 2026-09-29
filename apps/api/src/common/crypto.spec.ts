import {
  EncryptionService,
  hashPassword,
  hmacHex,
  safeEqualHex,
  sha256Hex,
  verifyPassword,
} from './crypto';

const svc = () =>
  new EncryptionService({
    env: { FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') },
  } as never);

describe('EncryptionService (AES-256-GCM)', () => {
  it('round-trips a value', () => {
    const s = svc();
    expect(s.decrypt(s.encrypt('1998-04-21'))).toBe('1998-04-21');
  });

  it('uses a fresh IV, so equal plaintexts give different ciphertexts', () => {
    const s = svc();
    expect(s.encrypt('1234')).not.toBe(s.encrypt('1234'));
  });

  it('never contains the plaintext', () => {
    expect(svc().encrypt('1998-04-21')).not.toContain('1998');
  });

  it('detects tampering', () => {
    const s = svc();
    const [v, iv, tag, ct] = s.encrypt('1234').split('.');
    const flipped = Buffer.from(ct as string, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => s.decrypt([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });

  it('fails with the wrong key', () => {
    const other = new EncryptionService({
      env: { FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') },
    } as never);
    expect(() => other.decrypt(svc().encrypt('1234'))).toThrow();
  });

  it('rejects unknown formats', () => {
    expect(() => svc().decrypt('garbage')).toThrow(/format/);
  });
});

describe('passwords', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });

  it('salts: same password hashes differently', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
  });
});

describe('hash helpers', () => {
  it('sha256 is deterministic and hex', () => {
    expect(sha256Hex('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  });
  it('hmac depends on the secret', () => {
    expect(hmacHex('k1', 'm')).not.toBe(hmacHex('k2', 'm'));
  });
  it('safeEqualHex compares in constant time and handles length mismatch', () => {
    expect(safeEqualHex(sha256Hex('a'), sha256Hex('a'))).toBe(true);
    expect(safeEqualHex(sha256Hex('a'), sha256Hex('b'))).toBe(false);
    expect(safeEqualHex('aa', 'aabb')).toBe(false);
  });
  it('rejects a value with trailing garbage appended to an otherwise-correct hex string', () => {
    // Buffer.from(str, 'hex') silently stops at the first byte it cannot decode (e.g.
    // Buffer.from('deadbeefx', 'hex') is just `deadbeef`), so comparing raw Buffers alone would
    // let a tampered signature with garbage appended pass as if it were the real one.
    const real = sha256Hex('secret');
    expect(safeEqualHex(real, `${real}x`)).toBe(false);
    expect(safeEqualHex(real, `x${real}`)).toBe(false);
  });
  it('rejects non-hex characters even at matching length', () => {
    expect(safeEqualHex('zz', 'zz')).toBe(false);
    expect(safeEqualHex('gg112233', 'gg112233')).toBe(false);
  });
});
