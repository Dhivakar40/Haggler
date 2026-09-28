import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { workerProfileUpdateSchema } from '@haggler/shared';
import type { z } from 'zod';
import { ApiZodBody, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { WorkerService } from './worker.service';

@ApiTags('ranger')
@ApiBearerAuth()
@Roles('WORKER')
@Controller({ path: 'worker', version: '1' })
export class WorkerController {
  constructor(private readonly worker: WorkerService) {}

  @Get('profile')
  @ApiOperation({ summary: 'My Ranger profile (verification tier, categories, bio)' })
  get(@CurrentUser() user: AuthUser) {
    return this.worker.getProfile(user.id);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update my Ranger profile and the categories I work in (max 5)' })
  @ApiZodBody(workerProfileUpdateSchema)
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(workerProfileUpdateSchema)) body: z.infer<typeof workerProfileUpdateSchema>,
  ) {
    return this.worker.updateProfile(user.id, body);
  }
}
