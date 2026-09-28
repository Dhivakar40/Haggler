import { Module } from '@nestjs/common';
import { KycProviderModule } from '../adapters/kyc/kyc.provider';
import { StorageModule } from '../adapters/storage/storage.service';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  imports: [KycProviderModule, StorageModule],
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
