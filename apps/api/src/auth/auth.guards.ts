import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@haggler/shared';
import { type AuthedRequest, IS_PUBLIC, ROLES_KEY } from '../common/decorators';
import { forbidden, unauthenticated } from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { JWT_AUDIENCE_USER, JWT_ISSUER } from './auth.constants';
import type { AccessClaims } from './token.service';

export function bearerToken(req: { headers: Record<string, unknown> }): string | null {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/**
 * Global guard: every route needs a valid user access token unless marked @Public().
 * Roles and account status are re-read from the database on every request, so suspending a user or
 * changing roles takes effect immediately, not when the 15-minute token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);
    if (!token) throw unauthenticated('Sign in to continue.');

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: this.env.env.JWT_ACCESS_SECRET,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE_USER,
      });
    } catch {
      throw unauthenticated('Your session has expired.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, status: true, roles: { select: { role: true } } },
    });
    if (!user || user.status !== 'ACTIVE') throw unauthenticated('This account is not available.');

    req.user = { id: user.id, roles: user.roles.map((r) => r.role), deviceRefId: claims.did };
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw unauthenticated();
    if (!required.some((r) => req.user?.roles.includes(r))) {
      throw forbidden(
        `This needs the ${required.includes('WORKER') ? 'Ranger' : required.join('/').toLowerCase()} role.`,
      );
    }
    return true;
  }
}
