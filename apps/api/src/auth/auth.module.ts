import { Module } from '@nestjs/common';
import { SmsModule } from '../adapters/sms/sms.provider';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';

@Module({
  imports: [SmsModule, UsersModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService],
})
export class AuthModule {}
