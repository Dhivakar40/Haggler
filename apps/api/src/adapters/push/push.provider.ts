import { Injectable, Logger, Module } from '@nestjs/common';
import { EnvService } from '../../config/env.service';

export interface PushMessage {
  title: string;
  body: string;
  /** String-valued only (FCM's data payload requirement); e.g. { jobId, type }. */
  data?: Record<string, string>;
}

export interface PushSendResult {
  /** Tokens FCM (or the sandbox) reports as dead — the caller should stop using them. */
  invalidTokens: string[];
}

export interface PushProvider {
  readonly mode: 'sandbox' | 'live';
  send(tokens: string[], message: PushMessage): Promise<PushSendResult>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface SandboxPush {
  tokens: string[];
  message: PushMessage;
  at: Date;
}

/**
 * Sandbox: no push leaves the machine. Kept in memory (`outbox`, used by tests) and, in
 * development only, logged so you can see what would have been sent without a real FCM project.
 */
@Injectable()
export class SandboxPushProvider implements PushProvider {
  readonly mode = 'sandbox' as const;
  readonly outbox: SandboxPush[] = [];
  private readonly logger = new Logger('SandboxPush');

  constructor(private readonly env: EnvService) {}

  async send(tokens: string[], message: PushMessage): Promise<PushSendResult> {
    this.outbox.push({ tokens, message, at: new Date() });
    if (this.outbox.length > 200) this.outbox.shift();
    if (this.env.env.NODE_ENV === 'development') {
      this.logger.log(
        `[SANDBOX PUSH] to ${tokens.length} device(s): "${message.title}" — ${message.body}`,
      );
    }
    return { invalidTokens: [] };
  }
}

/**
 * Firebase Cloud Messaging. NOT verified against a real FCM project (no service account has been
 * created yet); the multicast call shape and the dead-token detection follow the documented FCM
 * Admin SDK v12 API. `FCM_SERVICE_ACCOUNT_JSON` holds the whole service-account JSON as a string
 * (base64-encoded, to survive shell/CI env-var quoting the way `FIELD_ENCRYPTION_KEY` does).
 */
@Injectable()
export class FcmPushProvider implements PushProvider {
  readonly mode = 'live' as const;
  private readonly logger = new Logger('FcmPush');
  // Lazily created: importing firebase-admin's App type at the top of this file is fine, but we
  // only want to touch its credentials (and thus require FCM_SERVICE_ACCOUNT_JSON to be valid
  // JSON) the first time a push is actually sent, not at module-load time in sandbox mode.
  private messagingPromise: Promise<import('firebase-admin/messaging').Messaging> | null = null;

  constructor(private readonly env: EnvService) {}

  private async messaging(): Promise<import('firebase-admin/messaging').Messaging> {
    if (!this.messagingPromise) {
      this.messagingPromise = (async () => {
        const { initializeApp, cert, getApps } = await import('firebase-admin/app');
        const { getMessaging } = await import('firebase-admin/messaging');
        const raw = this.env.env.FCM_SERVICE_ACCOUNT_JSON ?? '';
        const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
        const serviceAccount = JSON.parse(json) as Record<string, string>;
        const app =
          getApps().find((a) => a.name === 'haggler-push') ??
          initializeApp({ credential: cert(serviceAccount) }, 'haggler-push');
        return getMessaging(app);
      })();
    }
    return this.messagingPromise;
  }

  async send(tokens: string[], message: PushMessage): Promise<PushSendResult> {
    if (tokens.length === 0) return { invalidTokens: [] };
    const messaging = await this.messaging();
    const invalidTokens: string[] = [];
    // FCM's multicast caps at 500 tokens per call; a single user rarely has more than a handful
    // of devices, but batch defensively rather than assume.
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const res = await messaging.sendEachForMulticast({
        tokens: batch,
        notification: { title: message.title, body: message.body },
        data: message.data,
      });
      res.responses.forEach((r, idx) => {
        if (r.success) return;
        const code = r.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-argument' ||
          code === 'messaging/invalid-registration-token'
        ) {
          invalidTokens.push(batch[idx] as string);
        } else {
          this.logger.warn(`push to one device failed (${code ?? 'unknown'}), keeping the token`);
        }
      });
    }
    return { invalidTokens };
  }
}

@Module({
  providers: [
    SandboxPushProvider,
    FcmPushProvider,
    {
      provide: PUSH_PROVIDER,
      inject: [EnvService, SandboxPushProvider, FcmPushProvider],
      useFactory: (
        env: EnvService,
        sandbox: SandboxPushProvider,
        live: FcmPushProvider,
      ): PushProvider => (env.env.PUSH_MODE === 'live' ? live : sandbox),
    },
  ],
  exports: [PUSH_PROVIDER, SandboxPushProvider],
})
export class PushProviderModule {}
