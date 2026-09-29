import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { renderHook } from '@testing-library/react-native';
import {
  BACKGROUND_TASK,
  cadenceFor,
  defineBackgroundTask,
  ensureBackgroundPermission,
  ensureForegroundPermission,
  startBackgroundTracking,
  useLocationTracker,
} from './tracker';
import { mockApi, signInAs } from '../test-utils';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => false),
}));

const loc = Location as unknown as Record<string, jest.Mock>;
const tm = TaskManager as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
  loc.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  loc.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  loc.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
  loc.watchPositionAsync.mockResolvedValue({ remove: jest.fn() });
});

describe('cadenceFor (battery-aware)', () => {
  it('idle-online is relaxed: 10 s / 20 m', () =>
    expect(cadenceFor('online')).toEqual({ timeIntervalMs: 10_000, distanceIntervalM: 20 }));
  it('on the way is the fastest allowed: 5 s / 10 m', () => {
    expect(cadenceFor('job', 'EN_ROUTE')).toEqual({ timeIntervalMs: 5_000, distanceIntervalM: 10 });
    expect(cadenceFor('job', 'AGREED')).toEqual({ timeIntervalMs: 5_000, distanceIntervalM: 10 });
  });
  it('standing at the door or working relaxes to 15 s', () => {
    expect(cadenceFor('job', 'ARRIVED').timeIntervalMs).toBe(15_000);
    expect(cadenceFor('job', 'IN_PROGRESS').timeIntervalMs).toBe(15_000);
  });
  it('never faster than 5 s or slower than 15 s (the 5-10 s spec, relaxed only when stationary)', () => {
    for (const [m, s] of [
      ['online', undefined],
      ['job', 'EN_ROUTE'],
      ['job', 'ARRIVED'],
    ] as const) {
      const c = cadenceFor(m, s);
      expect(c.timeIntervalMs).toBeGreaterThanOrEqual(5_000);
      expect(c.timeIntervalMs).toBeLessThanOrEqual(15_000);
    }
  });
});

describe('permissions', () => {
  it('asks only when not already granted', async () => {
    expect(await ensureForegroundPermission()).toBe(true);
    expect(loc.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    loc.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await ensureForegroundPermission()).toBe(false);
    loc.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    loc.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    expect(await ensureBackgroundPermission()).toBe(true);
  });
});

describe('background task', () => {
  it('starts with a visible foreground-service notification and battery-friendly settings', async () => {
    expect(await startBackgroundTracking({ timeIntervalMs: 5000, distanceIntervalM: 10 })).toBe(
      true,
    );
    expect(loc.startLocationUpdatesAsync).toHaveBeenCalledWith(
      BACKGROUND_TASK,
      expect.objectContaining({
        accuracy: 3,
        timeInterval: 5000,
        distanceInterval: 10,
        pausesUpdatesAutomatically: true,
        foregroundService: expect.objectContaining({
          notificationBody: expect.stringContaining('active job'),
        }),
      }),
    );
  });

  it('does not start twice', async () => {
    loc.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await startBackgroundTracking({ timeIntervalMs: 5000, distanceIntervalM: 10 });
    expect(loc.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('returns false (and keeps foreground tracking) if the platform refuses, e.g. Expo Go', async () => {
    loc.startLocationUpdatesAsync.mockRejectedValue(new Error('not available'));
    expect(await startBackgroundTracking({ timeIntervalMs: 5000, distanceIntervalM: 10 })).toBe(
      false,
    );
  });

  it('the task posts the newest position to the API', async () => {
    signInAs({ roles: ['CUSTOMER', 'WORKER'] });
    const { calls } = mockApi(() => ({ body: { recorded: true } }));
    defineBackgroundTask();
    const handler = tm.defineTask.mock.calls[0]?.[1] as (a: {
      data: unknown;
      error: unknown;
    }) => Promise<void>;
    await handler({
      data: {
        locations: [
          { coords: { latitude: 1, longitude: 2 } },
          { coords: { latitude: 13.08, longitude: 80.27, accuracy: 7 } },
        ],
      },
      error: null,
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/worker/location',
      body: { latitude: 13.08, longitude: 80.27, accuracyM: 7 },
    });
    await handler({ data: {}, error: new Error('x') }); // an error is ignored
    expect(calls).toHaveLength(1);
  });

  it('registers the task only once', () => {
    tm.isTaskDefined.mockReturnValue(true);
    defineBackgroundTask();
    expect(tm.defineTask).not.toHaveBeenCalled();
  });
});

describe('useLocationTracker', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('does nothing when off', async () => {
    await renderHook(() => useLocationTracker('off', undefined, jest.fn()));
    await flush();
    expect(loc.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('online: watches in the foreground at the idle cadence and forwards each fix', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    await renderHook(() => useLocationTracker('online', undefined, send));
    await flush();
    expect(loc.watchPositionAsync).toHaveBeenCalledWith(
      { accuracy: 3, timeInterval: 10_000, distanceInterval: 20 },
      expect.any(Function),
    );
    expect(loc.startLocationUpdatesAsync).not.toHaveBeenCalled(); // no background service while merely online
    const cb = loc.watchPositionAsync.mock.calls[0]?.[1] as (p: unknown) => void;
    cb({ coords: { latitude: 13.1, longitude: 80.2, accuracy: 9 } });
    expect(send).toHaveBeenCalledWith({ latitude: 13.1, longitude: 80.2, accuracyM: 9 });
  });

  it('job: also starts the background task, and stops everything on unmount', async () => {
    const remove = jest.fn();
    loc.watchPositionAsync.mockResolvedValue({ remove });
    loc.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { unmount } = await renderHook(() =>
      useLocationTracker('job', 'EN_ROUTE', jest.fn().mockResolvedValue(undefined)),
    );
    await flush();
    await flush();
    expect(loc.watchPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ timeInterval: 5_000 }),
      expect.any(Function),
    );
    expect(loc.startLocationUpdatesAsync).toHaveBeenCalled();
    unmount();
    await flush();
    expect(remove).toHaveBeenCalled();
    expect(loc.stopLocationUpdatesAsync).toHaveBeenCalledWith(BACKGROUND_TASK);
  });

  it('job without background permission still tracks in the foreground', async () => {
    loc.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    loc.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await renderHook(() =>
      useLocationTracker('job', 'EN_ROUTE', jest.fn().mockResolvedValue(undefined)),
    );
    await flush();
    await flush();
    expect(loc.watchPositionAsync).toHaveBeenCalled();
    expect(loc.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('no permission means no watching', async () => {
    loc.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await renderHook(() => useLocationTracker('online', undefined, jest.fn()));
    await flush();
    expect(loc.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('a send failure never crashes tracking', async () => {
    const send = jest.fn().mockRejectedValue(new Error('offline'));
    await renderHook(() => useLocationTracker('online', undefined, send));
    await flush();
    const cb = loc.watchPositionAsync.mock.calls[0]?.[1] as (p: unknown) => void;
    expect(() => cb({ coords: { latitude: 1, longitude: 2 } })).not.toThrow();
  });
});
