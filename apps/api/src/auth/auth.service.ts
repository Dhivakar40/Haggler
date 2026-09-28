import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthSession, OtpVerifyInput, RefreshInput, TokenPair } from '@haggler/shared';
import { CodedException } from '../common/http-errors';
import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@haggler/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  sendOtp(phone: string, ip: string | undefined) {
    return this.otp.send(phone, ip);
  }

  /** Verifies the code, creates the account on first sign-in, binds the device and issues tokens. */
  async verifyOtp(input: OtpVerifyInput, ip: string | undefined): Promise<AuthSession> {
    await this.otp.verify(input.phone, input.code);

    const { user, isNewUser } = await this.findOrCreateUser(input.phone);
    if (user.status !== 'ACTIVE') {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.ACCOUNT_UNAVAILABLE,
        user.status === 'DELETION_PENDING'
          ? 'This account is scheduled for deletion.'
          : 'This account is not available. Contact support.',
        { status: user.status },
      );
    }

    const device = await this.prisma.device.upsert({
      where: { userId_deviceId: { userId: user.id, deviceId: input.deviceId } },
      update: { platform: input.platform, lastSeenAt: new Date() },
      create: {
        userId: user.id,
        deviceId: input.deviceId,
        platform: input.platform,
        lastSeenAt: new Date(),
      },
    });

    const roles = user.roles.map((r) => r.role);
    const tokens = await this.tokens.issue({ id: user.id, roles }, device.id);
    const { refreshTokenId: _id, ...pair } = tokens;

    await this.audit.record({
      actorType: 'USER',
      actorId: user.id,
      action: isNewUser ? 'auth.signed_up' : 'auth.signed_in',
      entityType: 'user',
      entityId: user.id,
      ip,
    });
    return { ...pair, isNewUser, user: await this.users.getMe(user.id) };
  }

  private async findOrCreateUser(phone: string) {
    const existing = await this.prisma.user.findUnique({
      where: { phone },
      include: { roles: true },
    });
    if (existing) return { user: existing, isNewUser: false };
    try {
      const created = await this.prisma.user.create({
        data: { phone, phoneVerifiedAt: new Date(), roles: { create: { role: 'CUSTOMER' } } },
        include: { roles: true },
      });
      return { user: created, isNewUser: true };
    } catch (err) {
      // Two first-time sign-ins for the same number raced: the loser just reads the winner's row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const user = await this.prisma.user.findUniqueOrThrow({
          where: { phone },
          include: { roles: true },
        });
        return { user, isNewUser: false };
      }
      throw err;
    }
  }

  async refresh(input: RefreshInput): Promise<TokenPair> {
    return (await this.tokens.rotate(input.refreshToken, input.deviceId)).tokens;
  }

  logout(refreshToken: string) {
    return this.tokens.revokeByToken(refreshToken);
  }
}
