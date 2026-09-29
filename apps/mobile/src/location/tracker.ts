import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useRef } from 'react';
import { sendLocation } from '../api/market';

export const BACKGROUND_TASK = 'haggler-background-location';

export type TrackMode = 'off' | 'online' | 'job';

export interface Cadence {
  timeIntervalMs: number;
  distanceIntervalM: number;
}

/**
 * Battery-aware cadence (D3: a point every 5-10 s). More often only when it matters:
 *  - online and idle waiting for requests: every 10 s, and only if the phone moved >= 20 m;
 *  - on the way to the customer (job, EN_ROUTE / AGREED): every 5 s, moved >= 10 m;
 *  - at the customer's door or working (ARRIVED / IN_PROGRESS): they are standing still, so 15 s.
 * Balanced accuracy (not High) saves most of the battery. The OS may further batch updates.
 */
export function cadenceFor(mode: TrackMode, jobStatus?: string): Cadence {
  if (mode === 'job') {
    return jobStatus === 'ARRIVED' || jobStatus === 'IN_PROGRESS'
      ? { timeIntervalMs: 15_000, distanceIntervalM: 25 }
      : { timeIntervalMs: 5_000, distanceIntervalM: 10 };
  }
  return { timeIntervalMs: 10_000, distanceIntervalM: 20 };
}

export async function ensureForegroundPermission(): Promise<boolean> {
  const cur = await Location.getForegroundPermissionsAsync();
  if (cur.status === 'granted') return true;
  return (await Location.requestForegroundPermissionsAsync()).status === 'granted';
}

/** Background ("Always") permission, needed only to keep sharing location during a job while the app is not open. */
export async function ensureBackgroundPermission(): Promise<boolean> {
  const cur = await Location.getBackgroundPermissionsAsync();
  if (cur.status === 'granted') return true;
  return (await Location.requestBackgroundPermissionsAsync()).status === 'granted';
}

export async function startBackgroundTracking(cadence: Cadence): Promise<boolean> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK)) return true;
    await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: cadence.timeIntervalMs,
      distanceInterval: cadence.distanceIntervalM,
      pausesUpdatesAutomatically: true, // iOS: stop when the phone is stationary
      showsBackgroundLocationIndicator: true,
      // Android requires a visible notification for background location. It is also honest to the user.
      foregroundService: {
        notificationTitle: 'Haggler',
        notificationBody: 'Sharing your location for your active job',
      },
    });
    return true;
  } catch {
    return false; // e.g. Expo Go, or the permission was revoked: foreground tracking still works
  }
}

export async function stopBackgroundTracking(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK))
      await Location.stopLocationUpdatesAsync(BACKGROUND_TASK);
  } catch {
    /* nothing to stop */
  }
}

/**
 * The OS wakes this task with new positions, even when the app is not on screen. It talks to the
 * API over REST (no socket in the background) using the stored refresh token to stay signed in.
 */
export function defineBackgroundTask(): void {
  if (TaskManager.isTaskDefined(BACKGROUND_TASK)) return;
  TaskManager.defineTask(BACKGROUND_TASK, async ({ data, error }) => {
    if (error) return;
    const locations =
      (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
    const last = locations[locations.length - 1];
    if (!last) return;
    try {
      await sendLocation(
        last.coords.latitude,
        last.coords.longitude,
        last.coords.accuracy ?? undefined,
      );
    } catch {
      /* the next update will try again */
    }
  });
}

type Sender = (p: { latitude: number; longitude: number; accuracyM?: number }) => Promise<unknown>;

/**
 * Keeps the Ranger's location flowing while `mode` is not 'off'. `send` should prefer the live
 * socket and fall back to REST. Foreground watching is always used; the background task is added
 * only for an active job and only if "Always" permission was granted.
 */
export function useLocationTracker(
  mode: TrackMode,
  jobStatus: string | undefined,
  send: Sender,
): void {
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    if (mode === 'off') return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    const cadence = cadenceFor(mode, jobStatus);

    void (async () => {
      if (!(await ensureForegroundPermission())) return;
      const s = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: cadence.timeIntervalMs,
          distanceInterval: cadence.distanceIntervalM,
        },
        (pos) =>
          void sendRef
            .current({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracyM: pos.coords.accuracy ?? undefined,
            })
            .catch(() => undefined),
      );
      if (cancelled) s.remove();
      else sub = s;
      if (mode === 'job' && !cancelled && (await ensureBackgroundPermission()))
        await startBackgroundTracking(cadence);
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      if (mode === 'job') void stopBackgroundTracking();
    };
  }, [mode, jobStatus]);
}
