import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { SandboxSmsProvider } from '../src/adapters/sms/sms.provider';
import { hashPassword } from '../src/common/crypto';
import { PrismaService } from '../src/prisma/prisma.service';

let phoneCounter = 0;
let ipCounter = 0;
/** A unique valid Indian mobile number per call. */
export const newPhone = () => `+9198${String(70000000 + ++phoneCounter).padStart(8, '0')}`;
/** A unique client IP per call (the app trusts X-Forwarded-For in tests). */
export const newIp = () => `10.20.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

export interface Session {
  phone: string;
  ip: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  isNewUser: boolean;
}

export class Api {
  constructor(readonly app: INestApplication) {}
  readonly http = () => request(this.app.getHttpServer());
  readonly prisma = () => this.app.get(PrismaService);
  readonly sms = () => this.app.get(SandboxSmsProvider, { strict: false });

  /** Skip the 30 s resend cooldown legitimately, by ageing the phone's stored codes. */
  async ageOtps(phone: string, seconds = 60) {
    await this.prisma().$executeRaw`
      UPDATE otp_attempts SET created_at = created_at - make_interval(secs => ${seconds}) WHERE phone = ${phone}`;
  }

  async sendOtp(phone: string, ip = newIp()) {
    return this.http().post('/v1/auth/otp/send').set('X-Forwarded-For', ip).send({ phone });
  }

  /** Full sign-in through the real endpoints, reading the code from the sandbox SMS outbox. */
  async signIn(opts: { phone?: string; ip?: string; deviceId?: string } = {}): Promise<Session> {
    const phone = opts.phone ?? newPhone();
    const ip = opts.ip ?? newIp();
    const deviceId = opts.deviceId ?? `dev-${randomUUID()}`;
    await this.ageOtps(phone); // harmless when there is no previous code
    const sent = await this.sendOtp(phone, ip);
    if (sent.status !== 200)
      throw new Error(`send failed: ${sent.status} ${JSON.stringify(sent.body)}`);
    const code = this.sms().lastCodeFor(phone) as string;
    const res = await this.http()
      .post('/v1/auth/otp/verify')
      .set('X-Forwarded-For', ip)
      .send({ phone, code, deviceId, platform: 'android' });
    if (res.status !== 200)
      throw new Error(`verify failed: ${res.status} ${JSON.stringify(res.body)}`);
    return {
      phone,
      ip,
      deviceId,
      accessToken: res.body.accessToken,
      refreshToken: res.body.refreshToken,
      userId: res.body.user.id,
      isNewUser: res.body.isNewUser,
    };
  }

  auth(s: Session) {
    return { Authorization: `Bearer ${s.accessToken}`, 'X-Forwarded-For': s.ip };
  }
  get(s: Session, path: string) {
    return this.http().get(path).set(this.auth(s));
  }
  post(s: Session, path: string, body?: object) {
    return this.http().post(path).set(this.auth(s)).send(body);
  }
  patch(s: Session, path: string, body: object) {
    return this.http().patch(path).set(this.auth(s)).send(body);
  }
  del(s: Session, path: string) {
    return this.http().delete(path).set(this.auth(s));
  }

  async createAdmin(
    roles: ('KYC_REVIEWER' | 'DISPUTE_AGENT' | 'FINANCE' | 'SUPER_ADMIN')[],
    password = 'correct-horse-battery',
  ) {
    const email = `admin-${randomUUID().slice(0, 8)}@haggler.test`;
    const admin = await this.prisma().adminUser.create({
      data: {
        email,
        fullName: 'Test Admin',
        passwordHash: await hashPassword(password),
        roles: { create: roles.map((role) => ({ role })) },
      },
    });
    return { id: admin.id, email, password };
  }

  async adminToken(a: { email: string; password: string }): Promise<string> {
    const res = await this.http()
      .post('/v1/admin/auth/login')
      .set('X-Forwarded-For', newIp())
      .send(a);
    if (res.status !== 200) throw new Error(`admin login failed ${res.status}`);
    return res.body.accessToken;
  }

  adminGet(token: string, path: string) {
    return this.http()
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', newIp());
  }
  adminPost(token: string, path: string, body: object) {
    return this.http()
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', newIp())
      .send(body);
  }
}
