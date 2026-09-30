import { Injectable } from '@nestjs/common';
import type { StudentProfileDto, StudentProfileUpdate } from '@haggler/shared';
import { EncryptionService } from '../common/crypto';
import { conflict, notFound, unprocessable } from '../common/http-errors';
import { ageInYears, isValidPastDate } from '../kyc/kyc.rules';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A student's date of birth is self-declared, not admin-reviewed like a Ranger's Aadhaar-backed
 * DOB (D-063 known gap) — but the 18+ check it feeds is still a hard block enforced in code, not
 * a checkbox someone can tick past (D-060). Set once: a profile cannot lower its own age by
 * re-submitting a later date of birth, closing the obvious way to route around the block.
 */
@Injectable()
export class StudentProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async get(userId: string): Promise<StudentProfileDto> {
    const sp = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!sp) throw notFound('Student profile not found');
    return { instituteName: sp.instituteName };
  }

  async create(userId: string, input: StudentProfileUpdate): Promise<StudentProfileDto> {
    const existing = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (existing)
      throw conflict('Your date of birth is already on file and cannot be changed here.', {
        code: 'STUDENT_PROFILE_EXISTS',
      });
    const today = new Date();
    if (!isValidPastDate(input.dateOfBirth, today))
      throw unprocessable('Enter a real date of birth.', { code: 'INVALID_DATE' });
    if (ageInYears(input.dateOfBirth, today) < 18)
      throw unprocessable('You must be 18 or older to use Campus.', {
        code: 'UNDER_18',
      });
    const sp = await this.prisma.studentProfile.create({
      data: {
        userId,
        dateOfBirthEnc: this.encryption.encrypt(input.dateOfBirth),
        instituteName: input.instituteName ?? null,
      },
    });
    return { instituteName: sp.instituteName };
  }

  /** Only the institute name may be edited after creation; the DOB is set once (see class doc). */
  async updateInstitute(
    userId: string,
    instituteName: string | undefined,
  ): Promise<StudentProfileDto> {
    const sp = await this.prisma.studentProfile.update({
      where: { userId },
      data: { instituteName: instituteName ?? null },
    });
    return { instituteName: sp.instituteName };
  }

  /** Used by ApplicationsService: throws unless the account is an adult with a profile on file. */
  async assertEligible(userId: string): Promise<void> {
    const sp = await this.prisma.studentProfile.findUnique({ where: { userId } });
    if (!sp)
      throw unprocessable('Add your date of birth before applying to a Campus job.', {
        code: 'STUDENT_PROFILE_REQUIRED',
      });
    const dob = this.encryption.decrypt(sp.dateOfBirthEnc);
    if (ageInYears(dob, new Date()) < 18)
      throw unprocessable('You must be 18 or older to use Campus.', { code: 'UNDER_18' });
  }
}
