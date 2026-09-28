import { Injectable, Logger, Module } from '@nestjs/common';
import { EnvService } from '../../config/env.service';

export interface SmsProvider {
  readonly mode: 'sandbox' | 'live';
  /** `to` is E.164 (+91...). `code` is the OTP; providers build their own message. */
  sendOtp(to: string, code: string, ttlMinutes: number): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SandboxSms {
  to: string;
  code: string;
  at: Date;
}

/**
 * Sandbox: no SMS leaves the machine. Messages are kept in memory (`outbox`, used by tests) and,
 * in development only, printed to the API console so you can sign in without a phone.
 * This is the ONE place an OTP is ever logged, and it is refused in production (env check).
 */
@Injectable()
export class SandboxSmsProvider implements SmsProvider {
  readonly mode = 'sandbox' as const;
  readonly outbox: SandboxSms[] = [];
  private readonly logger = new Logger('SandboxSms');

  constructor(private readonly env: EnvService) {}

  async sendOtp(to: string, code: string): Promise<void> {
    this.outbox.push({ to, code, at: new Date() });
    if (this.outbox.length > 100) this.outbox.shift();
    if (this.env.env.NODE_ENV === 'development') {
      this.logger.warn(`[SANDBOX SMS] OTP for ${to}: ${code}`);
    }
  }

  lastCodeFor(phone: string): string | undefined {
    return [...this.outbox].reverse().find((m) => m.to === phone)?.code;
  }
}

/**
 * MSG91 OTP API. NOT verified against the real service (no account yet); it needs an approved
 * DLT template and auth key. Never logs the code.
 */
@Injectable()
export class Msg91SmsProvider implements SmsProvider {
  readonly mode = 'live' as const;

  constructor(private readonly env: EnvService) {}

  async sendOtp(to: string, code: string, ttlMinutes: number): Promise<void> {
    const { MSG91_AUTH_KEY, MSG91_TEMPLATE_ID } = this.env.env;
    const url = new URL('https://control.msg91.com/api/v5/otp');
    url.searchParams.set('template_id', MSG91_TEMPLATE_ID ?? '');
    url.searchParams.set('mobile', to.replace('+', ''));
    url.searchParams.set('otp', code);
    url.searchParams.set('otp_expiry', String(ttlMinutes));
    const res = await fetch(url, {
      method: 'POST',
      headers: { authkey: MSG91_AUTH_KEY ?? '', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`MSG91 responded ${res.status}`);
  }
}

@Module({
  providers: [
    SandboxSmsProvider,
    Msg91SmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [EnvService, SandboxSmsProvider, Msg91SmsProvider],
      useFactory: (
        env: EnvService,
        sandbox: SandboxSmsProvider,
        live: Msg91SmsProvider,
      ): SmsProvider => (env.env.SMS_MODE === 'live' ? live : sandbox),
    },
  ],
  exports: [SMS_PROVIDER, SandboxSmsProvider],
})
export class SmsModule {}
