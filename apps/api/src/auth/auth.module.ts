import { Module } from '@nestjs/common';
import { EmailModule } from '../adapters/email/email.provider';
import { SmsModule } from '../adapters/sms/sms.provider';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';

@Module({
  imports: [SmsModule, EmailModule, UsersModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService],
})
export class AuthModule {}
