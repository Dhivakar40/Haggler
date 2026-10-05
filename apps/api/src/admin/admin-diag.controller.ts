import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { diagGet, diagStop } from '../common/diag-timing';
import { AdminAuthGuard } from './admin-auth';

/**
 * TEMPORARY — D-078 confirm() latency accounting only. Not part of the product. Reads back the
 * timing marks recorded by a request sent with the X-Diag-Run trigger header. Removed once the
 * diagnosis is complete — see docs/DECISIONS.md.
 */
@ApiExcludeController()
@Public()
@UseGuards(AdminAuthGuard)
@Controller({ path: 'admin/diag', version: '1' })
export class AdminDiagController {
  @Get('timing')
  @ApiBearerAuth()
  timing() {
    const marks = diagGet();
    diagStop();
    const steps: { from: string; to: string; ms: number }[] = [];
    for (let i = 1; i < marks.length; i++) {
      const prev = marks[i - 1];
      const cur = marks[i];
      if (prev && cur) steps.push({ from: prev.label, to: cur.label, ms: cur.t - prev.t });
    }
    const first = marks[0];
    const last = marks[marks.length - 1];
    return {
      totalMs: first && last && marks.length > 1 ? last.t - first.t : null,
      marks,
      steps,
    };
  }
}
