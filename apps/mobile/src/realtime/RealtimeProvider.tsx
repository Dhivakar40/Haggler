import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import { SOCKET_EVENTS } from '@haggler/shared';
import { doRefresh, useSession } from '../auth/session';
import { RealtimeClient } from './socket';

const RealtimeContext = createContext<RealtimeClient | null>(null);

/** The app-wide realtime client. `null` outside a signed-in session. */
export const useRealtime = (): RealtimeClient | null => useContext(RealtimeContext);

/** Subscribe to one server event for the lifetime of a component. */
export function useRealtimeEvent<T = unknown>(event: string, handler: (payload: T) => void): void {
  const client = useRealtime();
  useEffect(() => (client ? client.on<T>(event, handler) : undefined), [client, event, handler]);
}

/**
 * Connects when signed in, disconnects on sign-out, and turns server events into cache refreshes:
 * an event means "this changed", and the screen re-reads the truth over REST (so a missed event is
 * harmless and there is no second copy of state to keep in sync).
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const client = useMemo(
    () =>
      signedIn
        ? new RealtimeClient({
            getToken: () => useSession.getState().accessToken,
            refresh: () => doRefresh().catch(() => false),
          })
        : null,
    [signedIn],
  );

  useEffect(() => {
    if (!client) return;
    client.connect();
    const offs = [
      client.on<{ jobId: string; requestId?: string }>(SOCKET_EVENTS.jobUpdated, (e) => {
        void qc.invalidateQueries({ queryKey: ['job', e.jobId] });
        if (e.requestId) void qc.invalidateQueries({ queryKey: ['request', e.requestId] });
        void qc.invalidateQueries({ queryKey: ['jobs'] });
      }),
      client.on(
        SOCKET_EVENTS.broadcast,
        () => void qc.invalidateQueries({ queryKey: ['incoming'] }),
      ),
      client.on(SOCKET_EVENTS.taken, () => void qc.invalidateQueries({ queryKey: ['incoming'] })),
      client.on<{ jobId: string; requestId: string }>(SOCKET_EVENTS.matched, (e) => {
        void qc.invalidateQueries({ queryKey: ['request', e.requestId] });
        void qc.invalidateQueries({ queryKey: ['job', e.jobId] });
        void qc.invalidateQueries({ queryKey: ['jobs'] });
      }),
      client.on<{ jobId: string }>(
        SOCKET_EVENTS.timeout,
        (e) => void qc.invalidateQueries({ queryKey: ['job', e.jobId] }),
      ),
      client.on<{ jobId: string }>(
        SOCKET_EVENTS.offerUpdated,
        (e) => void qc.invalidateQueries({ queryKey: ['job', e.jobId] }),
      ),
      client.on<{ threadId: string }>(
        SOCKET_EVENTS.chat,
        (m) => void qc.invalidateQueries({ queryKey: ['messages', m.threadId] }),
      ),
    ];
    return () => {
      offs.forEach((off) => off());
      client.disconnect();
    };
  }, [client, qc]);

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}
