import { Module } from '@nestjs/common';
import { StorageModule } from '../adapters/storage/storage.service';
import { AdminAuthGuard, AdminAuthService } from './admin-auth';
import { AdminController } from './admin.controller';
import { AdminEmployerService } from './admin-employer.service';
import { AdminKycService } from './admin-kyc.service';

@Module({
  imports: [StorageModule],
  controllers: [AdminController],
  providers: [AdminAuthService, AdminAuthGuard, AdminKycService, AdminEmployerService],
})
export class AdminModule {}
