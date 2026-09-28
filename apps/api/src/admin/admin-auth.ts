import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AdminRole } from '@haggler/shared';
import { z } from 'zod';
import { adminLoginSchema } from '@haggler/shared';
import { hashPassword, sha256Hex, verifyPassword } from '../common/crypto';
import { ADMIN_ROLES_KEY, type AuthedRequest } from '../common/decorators';
import { forbidden, RateLimitedException, unauthenticated } from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../ratelimit/rate-limit.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { bearerToken } from '../auth/auth.guards';
import { JWT_AUDIENCE_ADMIN, JWT_ISSUER } from '../auth/auth.constants';

const MAX_LOGIN_FAILURES = 5;
const LOGIN_WINDOW_SECONDS = 900;

interface AdminClaims {
  sub: string;
  email: string;
}

@Injectable()
export class AdminAuthService {
  private dummyHash: Promise<string> | null = null;
  private readonly memoryFailures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly env: EnvService,
    private readonly limiter: RateLimitService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async login(input: z.infer<typeof adminLoginSchema>, ip: string | undefined) {
    const email = input.email.trim().toLowerCase();
    await this.assertNotLocked(email);

    const admin = await this.prisma.adminUser.findUnique({
      where: { email },
      include: { roles: true },
    });
    // Always burn a password check, even for unknown emails, so response time does not reveal
    // which emails are real admins.
    this.dummyHash ??= hashPassword('dummy-password-for-timing');
    const ok = await verifyPassword(input.password, admin?.passwordHash ?? (await this.dummyHash));

    if (!admin || !admin.isActive || !ok) {
      await this.recordFailure(email);
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'admin.login_failed',
        entityType: 'admin_user',
        entityId: admin?.id ?? null,
        after: { emailHash: sha256Hex(email).slice(0, 16) },
        ip,
      });
      throw unauthenticated('Incorrect email or password.');
    }

    const { ADMIN_JWT_SECRET, ADMIN_JWT_TTL_SECONDS } = this.env.env;
    const claims: AdminClaims = { sub: admin.id, email: admin.email };
    const accessToken = await this.jwt.signAsync(claims, {
      secret: ADMIN_JWT_SECRET,
      expiresIn: ADMIN_JWT_TTL_SECONDS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE_ADMIN,
    });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'admin.login',
      entityType: 'admin_user',
      entityId: admin.id,
      ip,
    });
    return {
      accessToken,
      expiresInSeconds: ADMIN_JWT_TTL_SECONDS,
      admin: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        roles: admin.roles.map((r) => r.role),
      },
    };
  }

  private async assertNotLocked(email: string): Promise<void> {
    try {
      const key = `admin:login:${email}`;
      if (!(await this.redis.ping())) throw new Error('redis unavailable');
      const raw = await this.redis.client.get(key);
      if (Number(raw ?? 0) >= MAX_LOGIN_FAILURES) {
        const ttl = await this.redis.client.ttl(key);
        throw new RateLimitedException(
          ttl > 0 ? ttl : LOGIN_WINDOW_SECONDS,
          'Too many failed sign-ins. Try again later.',
        );
      }
    } catch (err) {
      if (err instanceof RateLimitedException) throw err;
      const m = this.memoryFailures.get(email);
      if (m && m.resetAt > Date.now() && m.count >= MAX_LOGIN_FAILURES) {
        throw new RateLimitedException(
          (m.resetAt - Date.now()) / 1000,
          'Too many failed sign-ins. Try again later.',
        );
      }
    }
  }

  private async recordFailure(email: string): Promise<void> {
    try {
      await this.limiter.hit(`admin:login:${email}`, MAX_LOGIN_FAILURES, LOGIN_WINDOW_SECONDS);
    } catch {
      const now = Date.now();
      const m = this.memoryFailures.get(email);
      const live =
        m && m.resetAt > now ? m : { count: 0, resetAt: now + LOGIN_WINDOW_SECONDS * 1000 };
      live.count += 1;
      this.memoryFailures.set(email, live);
    }
  }
}

/**
 * Guards /admin/* routes. Uses a different signing secret and audience than user tokens, so a user
 * token can never open an admin route (and vice versa). SUPER_ADMIN passes every role check.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);
    if (!token) throw unauthenticated('Admin sign-in required.');

    let claims: AdminClaims;
    try {
      claims = await this.jwt.verifyAsync<AdminClaims>(token, {
        secret: this.env.env.ADMIN_JWT_SECRET,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE_ADMIN,
      });
    } catch {
      throw unauthenticated('Your admin session has expired.');
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: claims.sub },
      include: { roles: true },
    });
    if (!admin || !admin.isActive) throw unauthenticated('This admin account is not active.');
    const roles = admin.roles.map((r) => r.role) as AdminRole[];

    const required = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (
      required?.length &&
      !roles.includes('SUPER_ADMIN') &&
      !required.some((r) => roles.includes(r))
    ) {
      throw forbidden('Your admin role cannot do this.');
    }
    req.admin = { id: admin.id, email: admin.email, roles };
    return true;
  }
}
