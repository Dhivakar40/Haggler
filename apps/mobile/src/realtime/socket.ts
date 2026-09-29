import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { SOCKET_EVENTS } from '@haggler/shared';
import { apiBaseUrl } from '../api/client';

type Handler = (payload: never) => void;
type SocketFactory = (url: string, opts: Record<string, unknown>) => Socket;

interface Options {
  getToken: () => string | null;
  /** Called when the server rejects our token: get a fresh one, resolve true to reconnect. */
  refresh: () => Promise<boolean>;
  factory?: SocketFactory;
}

export const useRealtimeStatus = create<{ connected: boolean }>()(() => ({ connected: false }));

/**
 * The phone's live connection (Socket.IO). Design notes:
 *  - The token is read fresh on EVERY (re)connect via the `auth` callback, so a reconnect after the
 *    15-minute access token rotated uses the new one.
 *  - If the server says `error.auth` (expired token) we refresh once and reconnect, instead of
 *    looping with a dead token.
 *  - Every server event is fanned out to listeners registered with `on`. Screens treat events as
 *    hints ("something changed") and re-read state over REST, so a missed event is harmless.
 *  - If the socket is down, `emitWithAck` fails fast and callers fall back to REST.
 */
export class RealtimeClient {
  private socket: Socket | null = null;
  private readonly listeners = new Map<string, Set<Handler>>();
  private refreshing = false;

  constructor(private readonly opts: Options) {}

  connect(): void {
    if (this.socket) return;
    const factory: SocketFactory = this.opts.factory ?? ((url, o) => io(url, o));
    const socket = factory(apiBaseUrl(), {
      transports: ['websocket'],
      auth: (cb: (data: object) => void) => cb({ token: this.opts.getToken() }),
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15_000,
    });
    this.socket = socket;

    socket.on('connect', () => useRealtimeStatus.setState({ connected: true }));
    socket.on('disconnect', () => useRealtimeStatus.setState({ connected: false }));
    socket.on('error.auth', () => void this.recover());
    for (const event of Object.values(SOCKET_EVENTS)) {
      if (event === SOCKET_EVENTS.accept) continue; // client -> server only
      socket.on(event, (payload: unknown) => this.dispatch(event, payload));
    }
  }

  private async recover(): Promise<void> {
    if (this.refreshing || !this.socket) return;
    this.refreshing = true;
    try {
      if (await this.opts.refresh()) this.socket?.connect();
    } finally {
      this.refreshing = false;
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const h of this.listeners.get(event) ?? []) {
      try {
        h(payload as never);
      } catch {
        /* one broken listener must not stop the others */
      }
    }
  }

  on<T = unknown>(event: string, handler: (payload: T) => void): () => void {
    const set = this.listeners.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.listeners.set(event, set);
    return () => set.delete(handler as Handler);
  }

  isConnected(): boolean {
    return this.socket?.connected === true;
  }

  /** Send an event and wait for the server's acknowledgement. Rejects when offline or after 5 s. */
  emitWithAck<T = unknown>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) return reject(new Error('offline'));
      this.socket
        .timeout(5000)
        .emit(event, payload, (err: Error | null, ack: T) => (err ? reject(err) : resolve(ack)));
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    useRealtimeStatus.setState({ connected: false });
  }
}
