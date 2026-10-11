/**
 * D-080 (Sub-phase E): a weak-signal moment (tunnel, elevator, lift lobby) used to just drop a
 * GPS ping on the floor — `sendLocation` failing was caught and ignored, leaving a gap in the
 * trail with nothing to fill it in once the connection came back. This queues a failed point
 * instead of discarding it, and sends it as soon as a later point succeeds.
 *
 * Deliberately NOT a historically-accurate backfill: a queued point is sent with whatever
 * timestamp the server assigns it on arrival, not the moment it was actually captured — doing
 * that properly would mean the API accepting and trusting a client-supplied `recordedAt` for the
 * GPS trail, which this round didn't want to risk touching (the same timestamp also feeds the
 * arrival-geofence freshness check, and getting that subtly wrong is a safety-relevant bug, not
 * a cosmetic one). This is "don't lose the point," not "get the trail's exact timing right."
 */
const MAX_QUEUED = 20;

export interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracyM?: number;
}

type Sender = (p: LocationPoint) => Promise<unknown>;

let queue: LocationPoint[] = [];

export function queueLength(): number {
  return queue.length;
}

/** Test-only: drop anything queued so one test's weak-signal spots don't bleed into the next. */
export function clearQueue(): void {
  queue = [];
}

/** Wraps a sender so a failed send joins the queue (oldest dropped first if it overflows — the
 * most recent position matters most for a live trail) instead of being lost, and every
 * successful send first flushes anything queued from earlier failures, oldest first. */
export function withRetryQueue(send: Sender): Sender {
  return async (point) => {
    const backlog = queue;
    queue = [];
    for (const p of backlog) {
      try {
        await send(p);
      } catch {
        queue.push(p);
      }
    }
    try {
      return await send(point);
    } catch (err) {
      queue.push(point);
      if (queue.length > MAX_QUEUED) queue.shift();
      throw err;
    }
  };
}
