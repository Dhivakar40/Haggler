import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TokenService } from './token.service';

/** Token issuing/rotation, shared by Auth and Users without a circular import. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [TokenService],
  exports: [TokenService, JwtModule],
})
export class SessionModule {}
