import { Module } from '@nestjs/common';
import { KycModule } from '../kyc/kyc.module';
import { UsersModule } from '../users/users.module';
import { MaintenanceService } from './maintenance.service';
import { QueuesService } from './queues.service';

@Module({
  imports: [UsersModule, KycModule],
  providers: [MaintenanceService, QueuesService],
  exports: [MaintenanceService, QueuesService],
})
export class MaintenanceModule {}
