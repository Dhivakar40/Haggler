import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma, RoleType } from '@prisma/client';
import type { TokenPair } from '@haggler/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { sha256Hex } from '../common/crypto';
import { unauthenticated } from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';
import { JWT_AUDIENCE_USER, JWT_ISSUER } from './auth.constants';

export interface AccessClaims {
  sub: string;
  roles: RoleType[];
  did: string | null;
}

/**
 * Sessions = short access JWT + rotating opaque refresh token.
 *
 * Rotation trace (family F):
 *   sign-in           -> R1 issued (family F)
 *   refresh with R1   -> R1 marked used, R2 issued (family F)
 *   refresh with R2   -> R2 used, R3 issued
 *   attacker replays R1 (already used) -> we see reuse, revoke the WHOLE family F: R3 dies too,
 *   so both the thief and the real user must sign in again, but the thief is out.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
  ) {}

  private newRefreshValue(): string {
    return randomBytes(32).toString('base64url');
  }

  async issue(
    user: { id: string; roles: RoleType[] },
    deviceRefId: string | null,
    familyId: string = randomUUID(),
    tx?: Prisma.TransactionClient,
    /** D-075: "keep me logged in". Carried forward on every rotation (see `rotate` below), so it
     * only needs to be chosen once, at sign-in. */
    rememberMe = false,
  ): Promise<TokenPair & { refreshTokenId: string }> {
    const { JWT_ACCESS_SECRET, JWT_ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, REFRESH_TTL_DAYS_REMEMBER_ME } =
      this.envService.env;
    const claims: AccessClaims = { sub: user.id, roles: user.roles, did: deviceRefId };
    const accessToken = await this.jwt.signAsync(claims, {
      secret: JWT_ACCESS_SECRET,
      expiresIn: JWT_ACCESS_TTL_SECONDS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE_USER,
    });
    const refreshToken = this.newRefreshValue();
    const ttlDays = rememberMe ? REFRESH_TTL_DAYS_REMEMBER_ME : REFRESH_TTL_DAYS;
    const db = tx ?? this.prisma;
    const row = await db.refreshToken.create({
      data: {
        userId: user.id,
        deviceRefId,
        tokenHash: sha256Hex(refreshToken),
        familyId,
        rememberMe,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
      },
    });
    return {
      accessToken,
      refreshToken,
      expiresInSeconds: JWT_ACCESS_TTL_SECONDS,
      refreshTokenId: row.id,
    };
  }

  /** Verifies the presented refresh token, retires it and issues the next pair. */
  async rotate(
    refreshToken: string,
    deviceId: string,
  ): Promise<{ userId: string; tokens: TokenPair }> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256Hex(refreshToken) },
      include: { device: true, user: { include: { roles: true } } },
    });
    if (!row) throw unauthenticated();

    if (row.revokedAt) {
      // An already-used token came back: assume theft and kill the whole family.
      await this.revokeFamily(row.familyId);
      this.logger.warn(`Refresh token reuse detected for user ${row.userId}; family revoked`);
      throw unauthenticated();
    }
    if (row.expiresAt <= new Date() || row.user.status !== 'ACTIVE') throw unauthenticated();
    // Device binding: a stolen refresh token is useless from a different device id.
    if (!row.device || row.device.deviceId !== deviceId) throw unauthenticated();

    const now = new Date();
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (claimed.count !== 1) {
      await this.revokeFamily(row.familyId);
      throw unauthenticated();
    }

    const next = await this.issue(
      { id: row.userId, roles: row.user.roles.map((r) => r.role) },
      row.deviceRefId,
      row.familyId,
      undefined,
      row.rememberMe,
    );
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { replacedById: next.refreshTokenId },
    });
    const { refreshTokenId: _ignored, ...tokens } = next;
    return { userId: row.userId, tokens };
  }

  revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Logout: idempotent, never reveals whether the token existed. */
  async revokeByToken(refreshToken: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256Hex(refreshToken) },
    });
    if (row) await this.revokeFamily(row.familyId);
  }

  revokeAllForUser(userId: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
