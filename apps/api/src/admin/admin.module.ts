import { Module } from '@nestjs/common';
import { StorageModule } from '../adapters/storage/storage.service';
import { AdminAuthGuard, AdminAuthService } from './admin-auth';
import { AdminController } from './admin.controller';
import { AdminEmployerService } from './admin-employer.service';
import { AdminKycService } from './admin-kyc.service';
import { AdminListingsService } from './admin-listings.service';
import { AdminReviewsService } from './admin-reviews.service';

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
  ],
})
export class AdminModule {}
