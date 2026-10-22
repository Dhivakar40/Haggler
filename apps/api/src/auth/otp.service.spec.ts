import { generateOtp, OtpService } from './otp.service';
import type { EmailProvider } from '../adapters/email/email.provider';
import type { SmsProvider } from '../adapters/sms/sms.provider';
import type { EnvService } from '../config/env.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RateLimitService } from '../ratelimit/rate-limit.service';

describe('generateOtp', () => {
  it('is always 6 digits, zero-padded', () => {
    for (let i = 0; i < 2000; i++) expect(generateOtp()).toMatch(/^[0-9]{6}$/);
  });

  it('is not constant and covers leading zeros', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateOtp()));
    expect(seen.size).toBeGreaterThan(400);
  });

  it('honours a custom length', () => {
    expect(generateOtp(4)).toMatch(/^[0-9]{4}$/);
  });
});

describe('OtpService.send (D-101: email delivery channel)', () => {
  function makeDeps() {
    const prisma = {
      otpAttempt: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]), // lockout check: no prior failures
        findFirst: jest.fn().mockResolvedValue(null), // cooldown check: no previous code
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService;
    const limiter = {
      hit: jest.fn().mockResolvedValue({ allowed: true, retryAfterSec: 0 }),
    } as unknown as RateLimitService;
    const env = { env: { JWT_ACCESS_SECRET: 'test-secret-at-least-32-bytes-long!!' } } as unknown as EnvService;
    const sms = { mode: 'sandbox', sendOtp: jest.fn().mockResolvedValue(undefined) } as unknown as SmsProvider;
    const email = { mode: 'sandbox', sendOtp: jest.fn().mockResolvedValue(undefined) } as unknown as EmailProvider;
    const svc = new OtpService(prisma, limiter, env, sms, email);
    return { svc, sms, email };
  }

  it('sends by SMS when no email is given', async () => {
    const { svc, sms, email } = makeDeps();
    await svc.send('+919876543210', '1.2.3.4');
    expect(sms.sendOtp).toHaveBeenCalledWith('+919876543210', expect.stringMatching(/^\d{6}$/), 5);
    expect(email.sendOtp).not.toHaveBeenCalled();
  });

  it('sends by email instead of SMS when an email is given', async () => {
    const { svc, sms, email } = makeDeps();
    await svc.send('+919876543210', '1.2.3.4', 'tester@example.com');
    expect(email.sendOtp).toHaveBeenCalledWith(
      'tester@example.com',
      expect.stringMatching(/^\d{6}$/),
      5,
    );
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });
});
