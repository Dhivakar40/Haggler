import { Global, Injectable, Module } from '@nestjs/common';
import { type Env, parseEnv } from './env';

@Injectable()
export class EnvService {
  readonly env: Env = parseEnv(process.env);
}

@Global()
@Module({ providers: [EnvService], exports: [EnvService] })
export class EnvModule {}
