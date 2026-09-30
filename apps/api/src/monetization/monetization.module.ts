import { Global, Module } from '@nestjs/common';
import { MonetizationConfig } from './monetization-config.service';
import { PlusController } from './plus.controller';
import { PlusService } from './plus.service';

/** Phase 9 (D-069): plan catalog + membership reads, and the rush/boost fee config. WalletService
 * (payments/wallet, Global too) imports this module to reuse PlusService's reads and
 * MonetizationConfig's fee amounts — a one-way dependency (Wallet -> Monetization) that keeps both
 * modules import-cycle-free; see PlusService's docblock. */
@Global()
@Module({
  controllers: [PlusController],
  providers: [PlusService, MonetizationConfig],
  exports: [PlusService, MonetizationConfig],
})
export class MonetizationModule {}
