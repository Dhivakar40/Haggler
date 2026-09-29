import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PushProvider } from '../adapters/push/push.provider';

describe('NotificationsService', () => {
  const makePrisma = (devices: { pushToken: string | null }[]) =>
    ({
      device: {
        findMany: jest.fn().mockResolvedValue(devices),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    }) as unknown as PrismaService;

  it('does nothing when the user has no registered push tokens', async () => {
    const prisma = makePrisma([]);
    const push: PushProvider = { mode: 'sandbox', send: jest.fn() };
    const svc = new NotificationsService(prisma, push);
    await svc.notify('u1', { title: 't', body: 'b' });
    expect(push.send).not.toHaveBeenCalled();
  });

  it('sends to every registered token for the user', async () => {
    const prisma = makePrisma([{ pushToken: 'tok-a' }, { pushToken: 'tok-b' }]);
    const send = jest.fn().mockResolvedValue({ invalidTokens: [] });
    const push: PushProvider = { mode: 'sandbox', send };
    const svc = new NotificationsService(prisma, push);
    await svc.notify('u1', { title: 't', body: 'b' });
    expect(send).toHaveBeenCalledWith(['tok-a', 'tok-b'], { title: 't', body: 'b' });
  });

  it('prunes tokens the provider reports as dead', async () => {
    const prisma = makePrisma([{ pushToken: 'tok-dead' }]);
    const push: PushProvider = {
      mode: 'live',
      send: jest.fn().mockResolvedValue({ invalidTokens: ['tok-dead'] }),
    };
    const svc = new NotificationsService(prisma, push);
    await svc.notify('u1', { title: 't', body: 'b' });
    expect(prisma.device.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', pushToken: { in: ['tok-dead'] } },
      data: { pushToken: null },
    });
  });

  it('never throws when the provider fails (a push must never fail its triggering request)', async () => {
    const prisma = makePrisma([{ pushToken: 'tok-a' }]);
    const push: PushProvider = {
      mode: 'live',
      send: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const svc = new NotificationsService(prisma, push);
    await expect(svc.notify('u1', { title: 't', body: 'b' })).resolves.toBeUndefined();
  });

  it('notifyMany de-duplicates user ids and notifies each once', async () => {
    const prisma = makePrisma([{ pushToken: 'tok-a' }]);
    const send = jest.fn().mockResolvedValue({ invalidTokens: [] });
    const push: PushProvider = { mode: 'sandbox', send };
    const svc = new NotificationsService(prisma, push);
    await svc.notifyMany(['u1', 'u1', 'u2'], { title: 't', body: 'b' });
    expect(prisma.device.findMany).toHaveBeenCalledTimes(2);
  });
});
