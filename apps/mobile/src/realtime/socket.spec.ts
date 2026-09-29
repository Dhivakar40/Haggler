import { RealtimeClient, useRealtimeStatus } from './socket';

/** A minimal fake of the Socket.IO client, so the wiring around it can be tested for real. */
function fakeSocket() {
  const handlers = new Map<string, ((p?: unknown) => void)[]>();
  const socket: {
    connected: boolean;
    on: jest.Mock;
    connect: jest.Mock;
    disconnect: jest.Mock;
    timeout: jest.Mock;
    emit: jest.Mock;
  } = {
    connected: false,
    on: jest.fn(
      (e: string, h: (p?: unknown) => void) =>
        void handlers.set(e, [...(handlers.get(e) ?? []), h]),
    ),
    connect: jest.fn(() => {
      socket.connected = true;
    }),
    disconnect: jest.fn(() => {
      socket.connected = false;
    }),
    timeout: jest.fn(() => ({ emit: socket.emit })),
    emit: jest.fn(),
  };
  const fire = (e: string, p?: unknown) => (handlers.get(e) ?? []).forEach((h) => h(p));
  return { socket, fire, handlers };
}

function setup(over: Partial<{ token: string | null; refresh: () => Promise<boolean> }> = {}) {
  const f = fakeSocket();
  let token = over.token ?? 'token-1';
  const refresh = jest.fn(over.refresh ?? (async () => true));
  let factoryOpts: Record<string, unknown> = {};
  const client = new RealtimeClient({
    getToken: () => token,
    refresh,
    factory: ((_url: string, opts: Record<string, unknown>) => {
      factoryOpts = opts;
      return f.socket;
    }) as never,
  });
  return { ...f, client, refresh, setToken: (t: string) => (token = t), opts: () => factoryOpts };
}

beforeEach(() => useRealtimeStatus.setState({ connected: false }));

describe('RealtimeClient', () => {
  it('reads the token fresh on every (re)connect, so a rotated access token is used', () => {
    const s = setup();
    s.client.connect();
    const auth = s.opts().auth as (cb: (d: object) => void) => void;
    const seen: unknown[] = [];
    auth((d) => seen.push(d));
    s.setToken('token-2');
    auth((d) => seen.push(d));
    expect(seen).toEqual([{ token: 'token-1' }, { token: 'token-2' }]);
    expect(s.opts()).toMatchObject({ transports: ['websocket'], reconnection: true });
  });

  it('connect() is idempotent (one socket)', () => {
    const s = setup();
    s.client.connect();
    s.client.connect();
    expect(s.socket.on.mock.calls.filter(([e]: [string]) => e === 'connect')).toHaveLength(1);
  });

  it('fans server events out to listeners; unsubscribe stops them; a broken listener does not block others', () => {
    const s = setup();
    s.client.connect();
    const a = jest.fn();
    const b = jest.fn();
    const off = s.client.on('job.updated', a);
    s.client.on('job.updated', () => {
      throw new Error('boom');
    });
    s.client.on('job.updated', b);
    s.fire('job.updated', { jobId: 'j1' });
    expect(a).toHaveBeenCalledWith({ jobId: 'j1' });
    expect(b).toHaveBeenCalledWith({ jobId: 'j1' });
    off();
    s.fire('job.updated', { jobId: 'j2' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('subscribes to every server event, but not to the client-to-server accept event', () => {
    const s = setup();
    s.client.connect();
    const subscribed = [...s.handlers.keys()];
    for (const e of [
      'request.broadcast',
      'request.taken',
      'request.matched',
      'request.timeout',
      'job.updated',
      'offer.updated',
      'location.update',
      'chat.message',
    ]) {
      expect(subscribed).toContain(e);
    }
    expect(subscribed).not.toContain('request.accept');
  });

  it('tracks connection state for the UI', () => {
    const s = setup();
    s.client.connect();
    s.fire('connect');
    expect(useRealtimeStatus.getState().connected).toBe(true);
    s.fire('disconnect');
    expect(useRealtimeStatus.getState().connected).toBe(false);
  });

  it('an expired token (error.auth) refreshes once and reconnects; a burst of errors refreshes only once', async () => {
    let release!: (v: boolean) => void;
    const s = setup({ refresh: () => new Promise<boolean>((r) => (release = r)) });
    s.client.connect();
    s.fire('error.auth');
    s.fire('error.auth');
    s.fire('error.auth');
    expect(s.refresh).toHaveBeenCalledTimes(1);
    release(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(s.socket.connect).toHaveBeenCalledTimes(1);
  });

  it('if the session is really over (refresh fails) it does not reconnect in a loop', async () => {
    const s = setup({ refresh: async () => false });
    s.client.connect();
    s.fire('error.auth');
    await new Promise((r) => setTimeout(r, 0));
    expect(s.socket.connect).not.toHaveBeenCalled();
  });

  it('emitWithAck: fails fast offline, resolves with the ack, rejects on timeout', async () => {
    const s = setup();
    s.client.connect();
    await expect(s.client.emitWithAck('location.update', {})).rejects.toThrow('offline');

    s.socket.connected = true;
    s.socket.emit.mockImplementationOnce(
      (_e: string, _p: unknown, cb: (err: Error | null, ack: unknown) => void) =>
        cb(null, { ok: true }),
    );
    await expect(s.client.emitWithAck('location.update', { latitude: 1 })).resolves.toEqual({
      ok: true,
    });
    expect(s.socket.timeout).toHaveBeenCalledWith(5000);

    s.socket.emit.mockImplementationOnce(
      (_e: string, _p: unknown, cb: (err: Error | null) => void) =>
        cb(new Error('operation has timed out')),
    );
    await expect(s.client.emitWithAck('chat.message', {})).rejects.toThrow('timed out');
  });

  it('disconnect() closes the socket and marks it offline; isConnected reflects the socket', () => {
    const s = setup();
    s.client.connect();
    s.socket.connected = true;
    expect(s.client.isConnected()).toBe(true);
    s.client.disconnect();
    expect(s.socket.disconnect).toHaveBeenCalled();
    expect(s.client.isConnected()).toBe(false);
    expect(useRealtimeStatus.getState().connected).toBe(false);
  });
});
