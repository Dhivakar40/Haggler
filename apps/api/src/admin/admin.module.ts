import { Module } from '@nestjs/common';
import { StorageModule } from '../adapters/storage/storage.service';
import { AdminAuthGuard, AdminAuthService } from './admin-auth';
import { AdminController } from './admin.controller';
import { AdminDisputesService } from './admin-disputes.service';
import { AdminEmployerService } from './admin-employer.service';
import { AdminOtherJobsService } from './admin-other-jobs.service';
import { AdminKycService } from './admin-kyc.service';
import { AdminListingsService } from './admin-listings.service';
import { AdminPriceListService } from './admin-price-list.service';
import { AdminReviewsService } from './admin-reviews.service';
import { AdminSosService } from './admin-sos.service';

@Module({
  imports: [StorageModule],
  controllers: [AdminController],
  providers: [
    AdminAuthService,
    AdminAuthGuard,
    AdminKycService,
    AdminEmployerService,
    AdminReviewsService,
    AdminListingsService,
    AdminPriceListService,
    AdminSosService,
    AdminDisputesService,
    AdminOtherJobsService,
  ],
})
export class AdminModule {}
