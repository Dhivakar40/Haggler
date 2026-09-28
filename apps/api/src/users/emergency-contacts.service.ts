import { Injectable } from '@nestjs/common';
import type { EmergencyContactDto, EmergencyContactInput } from '@haggler/shared';
import { MAX_EMERGENCY_CONTACTS } from '@haggler/shared';
import { conflict, notFound } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';

const select = { id: true, name: true, phone: true, relationship: true } as const;

@Injectable()
export class EmergencyContactsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<EmergencyContactDto[]> {
    return this.prisma.emergencyContact.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select,
    });
  }

  async create(userId: string, input: EmergencyContactInput): Promise<EmergencyContactDto> {
    const count = await this.prisma.emergencyContact.count({ where: { userId } });
    if (count >= MAX_EMERGENCY_CONTACTS)
      throw conflict(`You can add up to ${MAX_EMERGENCY_CONTACTS} emergency contacts.`);
    return this.prisma.emergencyContact.create({ data: { ...input, userId }, select });
  }

  async update(
    userId: string,
    id: string,
    input: Partial<EmergencyContactInput>,
  ): Promise<EmergencyContactDto> {
    const res = await this.prisma.emergencyContact.updateMany({
      where: { id, userId },
      data: input,
    });
    if (res.count === 0) throw notFound('Contact not found');
    return this.prisma.emergencyContact.findFirstOrThrow({ where: { id, userId }, select });
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.prisma.emergencyContact.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw notFound('Contact not found');
  }
}
