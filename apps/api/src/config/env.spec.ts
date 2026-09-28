import { adapterModes, EnvValidationError, parseEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults and defaults every adapter to sandbox', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(Object.values(adapterModes(env))).toEqual(Array(6).fill('sandbox'));
  });

  it('lists every problem at once', () => {
    try {
      parseEnv({ PORT: '99999', JWT_ACCESS_SECRET: 'short' });
      fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      const msg = (e as EnvValidationError).message;
      expect(msg).toContain('DATABASE_URL');
      expect(msg).toContain('REDIS_URL');
      expect(msg).toContain('PORT');
      expect(msg).toContain('JWT_ACCESS_SECRET');
    }
  });

  it('requires vendor credentials when an adapter is live', () => {
    expect(() => parseEnv({ ...base, PAYMENTS_MODE: 'live' })).toThrow(/RAZORPAY_KEY_ID/);
    expect(() =>
      parseEnv({
        ...base,
        PAYMENTS_MODE: 'live',
        RAZORPAY_KEY_ID: 'k',
        RAZORPAY_KEY_SECRET: 's',
        RAZORPAY_WEBHOOK_SECRET: 'w',
      }),
    ).not.toThrow();
  });

  it('refuses sandbox adapters in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /not allowed when NODE_ENV=production/,
    );
  });
});
