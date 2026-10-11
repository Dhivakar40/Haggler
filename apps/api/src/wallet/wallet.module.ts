import { Global, Module } from '@nestjs/common';
import { PaymentsAdapterModule } from '../adapters/payments/payments.provider';
import { MonetizationModule } from '../monetization/monetization.module';
import { RazorpayWebhookController, WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WorkerWalletController } from './worker-wallet.controller';
import { WorkerWalletService } from './worker-wallet.service';

@Global()
@Module({
  imports: [PaymentsAdapterModule, MonetizationModule],
  controllers: [WalletController, RazorpayWebhookController, WorkerWalletController],
  providers: [WalletService, WorkerWalletService],
  exports: [WalletService, WorkerWalletService],
})
export class WalletModule {}
