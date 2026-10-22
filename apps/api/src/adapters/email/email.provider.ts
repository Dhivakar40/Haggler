import { Injectable, Logger, Module } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { EnvService } from '../../config/env.service';

export interface EmailProvider {
  readonly mode: 'sandbox' | 'live';
  sendOtp(to: string, code: string, ttlMinutes: number): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface SandboxEmail {
  to: string;
  code: string;
  at: Date;
}

/**
 * D-101 (email OTP fallback): same sandbox/live split as every other adapter here. No email
 * leaves the machine in sandbox mode; kept in memory (`outbox`, used by tests) and, in
 * development only, printed to the console. This is the ONE place an OTP email is ever logged,
 * same rule as SandboxSmsProvider, and refused in production (env check, same pattern).
 */
@Injectable()
export class SandboxEmailProvider implements EmailProvider {
  readonly mode = 'sandbox' as const;
  readonly outbox: SandboxEmail[] = [];
  private readonly logger = new Logger('SandboxEmail');

  constructor(private readonly env: EnvService) {}

  async sendOtp(to: string, code: string): Promise<void> {
    this.outbox.push({ to, code, at: new Date() });
    if (this.outbox.length > 100) this.outbox.shift();
    if (this.env.env.NODE_ENV === 'development') {
      this.logger.warn(`[SANDBOX EMAIL] OTP for ${to}: ${code}`);
    }
  }

  lastCodeFor(email: string): string | undefined {
    return [...this.outbox].reverse().find((m) => m.to === email)?.code;
  }
}

/**
 * Plain SMTP via nodemailer — works with any SMTP account (Gmail with an app password, a free
 * tier from Brevo/SendGrid/etc., a self-hosted relay). Genuinely free when using a provider like
 * Gmail: no per-message cost and no DLT-style registration/approval pipeline, unlike SMS. Never
 * verified against a real mailbox in this project (no SMTP account existed to test against) —
 * same "not yet exercised against the real thing" caveat as Msg91SmsProvider.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  readonly mode = 'live' as const;
  private transporter: Transporter | null = null;

  constructor(private readonly env: EnvService) {}

  private get client(): Transporter {
    if (this.transporter) return this.transporter;
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = this.env.env;
    this.transporter = createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    return this.transporter;
  }

  async sendOtp(to: string, code: string, ttlMinutes: number): Promise<void> {
    await this.client.sendMail({
      from: this.env.env.SMTP_FROM,
      to,
      subject: `Your Haggler sign-in code: ${code}`,
      text: `Your Haggler sign-in code is ${code}. It expires in ${ttlMinutes} minutes. Never share this code with anyone.`,
    });
  }
}

@Module({
  providers: [
    SandboxEmailProvider,
    SmtpEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [EnvService, SandboxEmailProvider, SmtpEmailProvider],
      useFactory: (
        env: EnvService,
        sandbox: SandboxEmailProvider,
        live: SmtpEmailProvider,
      ): EmailProvider => (env.env.EMAIL_MODE === 'live' ? live : sandbox),
    },
  ],
  exports: [EMAIL_PROVIDER, SandboxEmailProvider],
})
export class EmailModule {}
