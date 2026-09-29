import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { goOnlineSchema, locationUpdateSchema } from '@haggler/shared';
import type { z } from 'zod';
import { ApiZodBody, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { MatchingService } from './matching.service';
import { PresenceService } from './presence.service';

/** Ranger presence and incoming requests. Path `/worker/*` as in the API spec; the UI says "Ranger". */
@ApiTags('ranger')
@ApiBearerAuth()
@Roles('WORKER')
@Controller({ path: 'worker', version: '1' })
export class WorkerPresenceController {
  constructor(
    private readonly presence: PresenceService,
    private readonly matching: MatchingService,
  ) {}

  @Post('online')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Go online (needs verification level 2 and at least one category). Sends the first location.',
  })
  @ApiZodBody(goOnlineSchema)
  online(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(goOnlineSchema)) body: z.infer<typeof goOnlineSchema>,
  ) {
    return this.presence.goOnline(u.id, body.latitude, body.longitude);
  }

  @Post('offline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Go offline: no new requests' })
  offline(@CurrentUser() u: AuthUser) {
    return this.presence.goOffline(u.id);
  }

  @Get('presence')
  @ApiOperation({ summary: 'Am I online right now (heartbeat fresh)?' })
  status(@CurrentUser() u: AuthUser) {
    return this.presence.status(u.id);
  }

  @Post('location')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Location heartbeat (every 5-10 s). While on a job it also extends the GPS trail and pushes to the customer.',
  })
  @ApiZodBody(locationUpdateSchema)
  location(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(locationUpdateSchema)) body: z.infer<typeof locationUpdateSchema>,
  ) {
    return this.presence.updateLocation(u.id, body);
  }

  @Get('incoming')
  @ApiOperation({ summary: 'Requests currently waiting for my answer (use after reconnecting)' })
  incoming(@CurrentUser() u: AuthUser) {
    return this.matching.incomingList(u.id);
  }
}
