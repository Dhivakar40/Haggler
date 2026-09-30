import { Module } from '@nestjs/common';
import { CampusApplicationsService } from './campus-applications.service';
import { CampusConfig } from './campus-config.service';
import { CampusListingsService } from './campus-listings.service';
import {
  CampusController,
  EmployerCampusController,
  MyCampusApplicationsController,
  StudentProfileController,
} from './campus.controller';
import { StudentProfileService } from './student-profile.service';

/** Campus (Phase 7): part-time student jobs. Job board mechanics reused from Phase 6's Contract
 * labour (D-054), plus Campus-only safeguards — see docs/DECISIONS.md D-060 through D-063. */
@Module({
  controllers: [
    StudentProfileController,
    EmployerCampusController,
    CampusController,
    MyCampusApplicationsController,
  ],
  providers: [
    StudentProfileService,
    CampusListingsService,
    CampusApplicationsService,
    CampusConfig,
  ],
  exports: [CampusConfig],
})
export class CampusModule {}
