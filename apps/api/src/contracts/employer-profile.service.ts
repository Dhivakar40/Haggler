import { Injectable } from '@nestjs/common';
import type { EmployerProfileDto, EmployerProfileUpdate } from '@haggler/shared';
import { notFound } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';

/** A light employer identity (Phase 6): a business name is all that's required to post a
 * listing. No document verification exists yet (D-054 known gap). */
@Injectable()
export class EmployerProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<EmployerProfileDto> {
    const ep = await this.prisma.employerProfile.findUnique({ where: { userId } });
    if (!ep) throw notFound('Employer profile not found');
    return { businessName: ep.businessName };
  }

  async upsert(userId: string, input: EmployerProfileUpdate): Promise<EmployerProfileDto> {
    const ep = await this.prisma.employerProfile.upsert({
      where: { userId },
      update: { businessName: input.businessName },
      create: { userId, businessName: input.businessName },
    });
    return { businessName: ep.businessName };
  }
}
