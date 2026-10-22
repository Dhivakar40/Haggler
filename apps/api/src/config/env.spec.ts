import { adapterModes, EnvValidationError, parseEnv } from './env';

const KEY = Buffer.alloc(32, 7).toString('base64');
export const baseEnv = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  ADMIN_JWT_SECRET: 'y'.repeat(32),
  FIELD_ENCRYPTION_KEY: KEY,
  S3_ACCESS_KEY: 'a',
  S3_SECRET_KEY: 'b',
};

describe('parseEnv', () => {
  it('applies defaults; adapters default to safe modes', () => {
    const env = parseEnv(baseEnv);
    expect(env.PORT).toBe(3000);
    expect(adapterModes(env)).toEqual({
      sms: 'sandbox',
      kyc: 'manual_admin',
      payments: 'sandbox',
      calls: 'disabled',
      push: 'sandbox',
      maps: 'sandbox',
    });
  });

  it('lists every problem at once', () => {
    try {
      parseEnv({ PORT: '99999', JWT_ACCESS_SECRET: 'short' });
      fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      const msg = (e as EnvValidationError).message;
      for (const k of [
        'DATABASE_URL',
        'REDIS_URL',
        'PORT',
        'JWT_ACCESS_SECRET',
        'FIELD_ENCRYPTION_KEY',
      ]) {
        expect(msg).toContain(k);
      }
    }
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() =>
      parseEnv({ ...baseEnv, FIELD_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/32 bytes/);
  });

  it('payments test mode needs Razorpay TEST keys and refuses live keys (D-020)', () => {
    const test = {
      ...baseEnv,
      PAYMENTS_MODE: 'test',
      RAZORPAY_KEY_SECRET: 's',
      RAZORPAY_WEBHOOK_SECRET: 'w',
    };
    expect(() => parseEnv({ ...test, RAZORPAY_KEY_ID: 'rzp_test_abc' })).not.toThrow();
    expect(() => parseEnv({ ...test, RAZORPAY_KEY_ID: 'rzp_live_abc' })).toThrow(/TEST keys/);
    expect(() => parseEnv({ ...test })).toThrow(/RAZORPAY_KEY_ID/);
  });

  it('there is no live payments mode', () => {
    expect(() => parseEnv({ ...baseEnv, PAYMENTS_MODE: 'live' })).toThrow();
  });

  it('live SMS needs MSG91 credentials', () => {
    expect(() => parseEnv({ ...baseEnv, SMS_MODE: 'live' })).toThrow(/MSG91_AUTH_KEY/);
  });

  it('osm maps need an identifying user agent', () => {
    expect(() => parseEnv({ ...baseEnv, MAPS_MODE: 'osm' })).toThrow(/NOMINATIM_USER_AGENT/);
  });

  it('refuses sandbox adapters in production', () => {
    expect(() => parseEnv({ ...baseEnv, NODE_ENV: 'production' })).toThrow(
      /not allowed when NODE_ENV=production/,
    );
  });

  it('TESTING_MODE defaults to false and is allowed outside production (D-074)', () => {
    expect(parseEnv(baseEnv).TESTING_MODE).toBe(false);
    expect(parseEnv({ ...baseEnv, TESTING_MODE: 'true' }).TESTING_MODE).toBe(true);
  });

  it('refuses TESTING_MODE=true in production (D-074)', () => {
    const prodEnv = {
      ...baseEnv,
      NODE_ENV: 'production',
      SMS_MODE: 'live',
      MSG91_AUTH_KEY: 'k',
      MSG91_TEMPLATE_ID: 't',
      PUSH_MODE: 'live',
      FCM_SERVICE_ACCOUNT_JSON: '{}',
      MAPS_MODE: 'osm',
      NOMINATIM_USER_AGENT: 'haggler/1.0',
      PAYMENTS_MODE: 'test',
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      RAZORPAY_KEY_SECRET: 's',
      RAZORPAY_WEBHOOK_SECRET: 'w',
    };
    expect(() => parseEnv(prodEnv)).not.toThrow(); // sanity: this prod env is otherwise valid
    expect(() => parseEnv({ ...prodEnv, TESTING_MODE: 'true' })).toThrow(
      /TESTING_MODE=true is not allowed when NODE_ENV=production/,
    );
  });
});
