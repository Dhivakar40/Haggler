import { Controller, Get, Header, Param, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { TrackingService } from './tracking.service';

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/** JSON for the live trip link (no login). Rate-limited so tokens cannot be brute-forced. */
@ApiTags('tracking')
@Public()
@Controller({ path: 'track', version: '1' })
export class PublicTrackController {
  constructor(private readonly tracking: TrackingService) {}

  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "Live trip link contents: status and the Ranger's position. No phone numbers.",
  })
  view(@Param('token') token: string) {
    return this.tracking.publicView(token);
  }
}

/** The page a trusted contact opens from the link. Plain HTML, no scripts, refreshes itself. */
@ApiExcludeController()
@Public()
@Controller({ path: 't', version: VERSION_NEUTRAL })
export class PublicTrackPageController {
  constructor(private readonly tracking: TrackingService) {}

  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async page(@Param('token') token: string): Promise<string> {
    const v = await this.tracking.publicView(token);
    const where = v.worker
      ? `<p>Last seen: <a href="https://www.openstreetmap.org/?mlat=${v.worker.latitude}&amp;mlon=${v.worker.longitude}#map=16/${v.worker.latitude}/${v.worker.longitude}">${v.worker.latitude.toFixed(5)}, ${v.worker.longitude.toFixed(5)}</a> at ${esc(new Date(v.worker.recordedAt).toLocaleTimeString('en-IN'))}</p>`
      : '<p>Location is not being shared right now.</p>';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="15"><title>Haggler live trip</title></head><body style="font-family:system-ui;max-width:520px;margin:24px auto;padding:0 16px"><h1>Haggler live trip</h1><p>Ranger ${esc(v.rangerFirstName ?? '')} is helping with: <b>${esc(v.category.replace(/_/g, ' '))}</b></p><p>Status: <b>${esc(v.status.replace(/_/g, ' ').toLowerCase())}</b></p>${where}<p style="color:#555">This link expires at ${esc(new Date(v.expiresAt).toLocaleString('en-IN'))}.</p></body></html>`;
  }
}
