import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './crypto';

@Global()
@Module({ providers: [EncryptionService], exports: [EncryptionService] })
export class CryptoModule {}
