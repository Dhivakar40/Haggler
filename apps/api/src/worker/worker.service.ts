import { Injectable } from '@nestjs/common';
import type { WorkerProfileDto, WorkerProfileUpdate } from '@haggler/shared';
import { notFound, unprocessable } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';

/** "Worker" is the internal name; users see "Ranger" (D-003). */
@Injectable()
export class WorkerService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<WorkerProfileDto> {
    const wp = await this.prisma.workerProfile.findUnique({
      where: { userId },
      include: { categories: { include: { category: { select: { slug: true } } } } },
    });
    if (!wp) throw notFound('Ranger profile not found');
    return {
      kycTier: wp.kycTier,
      bio: wp.bio,
      experienceYears: wp.experienceYears,
      categorySlugs: wp.categories.map((c) => c.category.slug).sort(),
    };
  }

  async updateProfile(userId: string, input: WorkerProfileUpdate): Promise<WorkerProfileDto> {
    const wp = await this.prisma.workerProfile.findUnique({ where: { userId } });
    if (!wp) throw notFound('Ranger profile not found');

    let categoryIds: string[] | undefined;
    if (input.categorySlugs) {
      const slugs = [...new Set(input.categorySlugs)];
      const found = await this.prisma.serviceCategory.findMany({
        where: { slug: { in: slugs }, isActive: true },
        select: { id: true, slug: true },
      });
      const missing = slugs.filter((s) => !found.some((f) => f.slug === s));
      if (missing.length) throw unprocessable('Unknown categories', { missing });
      categoryIds = found.map((f) => f.id);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.workerProfile.update({
        where: { id: wp.id },
        data: {
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          ...(input.experienceYears !== undefined
            ? { experienceYears: input.experienceYears }
            : {}),
        },
      });
      if (categoryIds) {
        await tx.workerCategory.deleteMany({ where: { workerProfileId: wp.id } });
        await tx.workerCategory.createMany({
          data: categoryIds.map((categoryId) => ({ workerProfileId: wp.id, categoryId })),
        });
      }
    });
    return this.getProfile(userId);
  }
}
