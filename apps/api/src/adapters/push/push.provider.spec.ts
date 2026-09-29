import { SandboxPushProvider } from './push.provider';
import { EnvService } from '../../config/env.service';

describe('SandboxPushProvider', () => {
  const makeEnv = (nodeEnv: 'development' | 'test' | 'production') =>
    ({ env: { NODE_ENV: nodeEnv } }) as EnvService;

  it('records every send in the outbox and reports no invalid tokens', async () => {
    const p = new SandboxPushProvider(makeEnv('test'));
    const res = await p.send(['tok-1', 'tok-2'], { title: 'Hi', body: 'There' });
    expect(res.invalidTokens).toEqual([]);
    expect(p.outbox).toHaveLength(1);
    expect(p.outbox[0]).toMatchObject({
      tokens: ['tok-1', 'tok-2'],
      message: { title: 'Hi', body: 'There' },
    });
  });

  it('never leaves the machine: mode is sandbox', () => {
    expect(new SandboxPushProvider(makeEnv('test')).mode).toBe('sandbox');
  });

  it('caps the outbox at 200 entries so it cannot leak memory over a long test run', async () => {
    const p = new SandboxPushProvider(makeEnv('test'));
    for (let i = 0; i < 210; i++) await p.send(['t'], { title: 'x', body: String(i) });
    expect(p.outbox).toHaveLength(200);
    expect(p.outbox[0]?.message.body).toBe('10'); // the oldest 10 were shifted out
  });
});
