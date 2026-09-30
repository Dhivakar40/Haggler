import { Global, Module } from '@nestjs/common';
import { PaymentsAdapterModule } from '../adapters/payments/payments.provider';
import { MonetizationModule } from '../monetization/monetization.module';
import { RazorpayWebhookController, WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Global()
@Module({
  imports: [PaymentsAdapterModule, MonetizationModule],
  controllers: [WalletController, RazorpayWebhookController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
