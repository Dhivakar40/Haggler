import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { hmacHex, safeEqualHex } from '../common/crypto';
import { CodedException, otpInvalid, RateLimitedException } from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../ratelimit/rate-limit.service';
import { SMS_PROVIDER, type SmsProvider } from '../adapters/sms/sms.provider';
import { ERROR_CODES } from '@haggler/shared';
import {
  HOUR_SECONDS,
  OTP_LENGTH,
  OTP_LOCKOUT_FAILURES,
  OTP_LOCKOUT_WINDOW_SECONDS,
  OTP_MAX_VERIFY_TRIES,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SENDS_PER_IP_PER_HOUR,
  OTP_SENDS_PER_PHONE_PER_HOUR,
  OTP_TTL_SECONDS,
} from './auth.constants';

/** QA/testing builds only (D-074). Never matched unless TESTING_MODE=true, which env.ts refuses
 * outright when NODE_ENV=production — see the superRefine there. */
export const TESTING_MODE_FIXED_CODE = '123456';

/** Zero-padded uniform random code. randomInt is cryptographically secure (not Math.random). */
export function generateOtp(length = OTP_LENGTH): string {
  return String(randomInt(0, 10 ** length)).padStart(length, '0');
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimitService,
    private readonly env: EnvService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private hashCode(phone: string, code: string): string {
    return hmacHex(this.env.env.JWT_ACCESS_SECRET, `otp:${phone}:${code}`);
  }

  async send(phone: string, ip: string | undefined) {
    await this.assertNotLockedOut(phone);
    await this.assertCooldown(phone);
    await this.assertSendQuota(phone, ip);

    const code = generateOtp();
    const now = new Date();
    // Only the newest code is valid: retire older ones so an intercepted old code is useless.
    await this.prisma.otpAttempt.updateMany({
      where: { phone, consumedAt: null },
      data: { consumedAt: now },
    });
    const row = await this.prisma.otpAttempt.create({
      data: {
        phone,
        codeHash: this.hashCode(phone, code),
        ip,
        expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
      },
    });

    try {
      await this.sms.sendOtp(phone, code, OTP_TTL_SECONDS / 60);
    } catch (err) {
      await this.prisma.otpAttempt.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      });
      this.logger.error(`SMS send failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new CodedException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ERROR_CODES.INTERNAL,
        'Could not send the code. Try again shortly.',
      );
    }
    return {
      sent: true,
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  /** Consumes the code on success. Throws OTP_INVALID for every failure (no hints for attackers). */
  async verify(phone: string, code: string): Promise<void> {
    // QA/testing builds only (D-074): a fixed code that works for any phone number, so teammates
    // testing a standalone APK don't need to read the real code off someone's server console. Only
    // reachable when TESTING_MODE=true, which env.ts refuses outright in production — this branch
    // is dead code there. Logged loudly every time it's used so it's never silently relied on.
    if (this.env.env.TESTING_MODE && code === TESTING_MODE_FIXED_CODE) {
      this.logger.warn(`TESTING_MODE: fixed OTP accepted for ${phone}`);
      return;
    }
    await this.assertNotLockedOut(phone);
    const now = new Date();
    const row = await this.prisma.otpAttempt.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || row.failedTries >= OTP_MAX_VERIFY_TRIES) throw otpInvalid();

    const ok = safeEqualHex(row.codeHash, this.hashCode(phone, code));
    if (!ok) {
      const updated = await this.prisma.otpAttempt.update({
        where: { id: row.id },
        data: { failedTries: { increment: 1 } },
      });
      if (updated.failedTries >= OTP_MAX_VERIFY_TRIES) {
        await this.prisma.otpAttempt.update({ where: { id: row.id }, data: { consumedAt: now } });
      }
      throw otpInvalid();
    }

    // Atomic claim: if two requests race with the right code, exactly one wins.
    const claimed = await this.prisma.otpAttempt.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw otpInvalid();
  }

  /**
   * Lockout is computed from Postgres (authoritative, survives a Redis outage): if the codes issued
   * to this phone in the last 30 minutes have collected >= 10 wrong guesses in total, block it.
   */
  private async assertNotLockedOut(phone: string): Promise<void> {
    const since = new Date(Date.now() - OTP_LOCKOUT_WINDOW_SECONDS * 1000);
    const rows = await this.prisma.otpAttempt.findMany({
      where: { phone, createdAt: { gte: since }, failedTries: { gt: 0 } },
      select: { failedTries: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const failures = rows.reduce((n, r) => n + r.failedTries, 0);
    if (failures >= OTP_LOCKOUT_FAILURES) {
      const earliest = rows[0]?.createdAt ?? new Date();
      const retry = OTP_LOCKOUT_WINDOW_SECONDS - (Date.now() - earliest.getTime()) / 1000;
      throw new RateLimitedException(
        retry,
        'Too many wrong codes. This number is locked for a while.',
      );
    }
  }

  private async assertCooldown(phone: string): Promise<void> {
    const last = await this.prisma.otpAttempt.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (!last) return;
    const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
    if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
      throw new RateLimitedException(
        OTP_RESEND_COOLDOWN_SECONDS - elapsed,
        'Please wait before asking for another code.',
      );
    }
  }

  /** Redis-first hourly quotas per phone and per IP; if Redis is down, count rows in Postgres instead. */
  private async assertSendQuota(phone: string, ip: string | undefined): Promise<void> {
    try {
      const byPhone = await this.limiter.hit(
        `otp:send:phone:${phone}`,
        OTP_SENDS_PER_PHONE_PER_HOUR,
        HOUR_SECONDS,
      );
      if (!byPhone.allowed)
        throw new RateLimitedException(
          byPhone.retryAfterSec,
          'Too many codes requested for this number.',
        );
      if (ip) {
        const byIp = await this.limiter.hit(
          `otp:send:ip:${ip}`,
          OTP_SENDS_PER_IP_PER_HOUR,
          HOUR_SECONDS,
        );
        if (!byIp.allowed)
          throw new RateLimitedException(
            byIp.retryAfterSec,
            'Too many codes requested from this network.',
          );
      }
    } catch (err) {
      if (err instanceof RateLimitedException) throw err;
      this.logger.warn('Redis unavailable: enforcing OTP quotas from Postgres');
      const since = new Date(Date.now() - HOUR_SECONDS * 1000);
      const [phoneCount, ipCount] = await Promise.all([
        this.prisma.otpAttempt.count({ where: { phone, createdAt: { gte: since } } }),
        ip
          ? this.prisma.otpAttempt.count({ where: { ip, createdAt: { gte: since } } })
          : Promise.resolve(0),
      ]);
      if (phoneCount >= OTP_SENDS_PER_PHONE_PER_HOUR)
        throw new RateLimitedException(HOUR_SECONDS, 'Too many codes requested for this number.');
      if (ipCount >= OTP_SENDS_PER_IP_PER_HOUR)
        throw new RateLimitedException(HOUR_SECONDS, 'Too many codes requested from this network.');
    }
  }
}
