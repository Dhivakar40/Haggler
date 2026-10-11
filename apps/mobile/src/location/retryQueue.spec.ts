import { clearQueue, queueLength, withRetryQueue } from './retryQueue';

const P1 = { latitude: 1, longitude: 1 };
const P2 = { latitude: 2, longitude: 2 };
const P3 = { latitude: 3, longitude: 3 };

beforeEach(() => clearQueue());

describe('withRetryQueue', () => {
  it('a successful send with nothing queued just sends the point', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    await withRetryQueue(send)(P1);
    expect(send).toHaveBeenCalledWith(P1);
    expect(queueLength()).toBe(0);
  });

  it('a failed send queues the point instead of losing it, and rethrows', async () => {
    const send = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(withRetryQueue(send)(P1)).rejects.toThrow('offline');
    expect(queueLength()).toBe(1);
  });

  it('the next successful send flushes the queued point first, oldest first', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const wrapped = withRetryQueue(send);
    await expect(wrapped(P1)).rejects.toThrow();
    expect(queueLength()).toBe(1);

    await wrapped(P2);
    expect(send).toHaveBeenNthCalledWith(2, P1); // the queued point first
    expect(send).toHaveBeenNthCalledWith(3, P2); // then the new one
    expect(queueLength()).toBe(0);
  });

  it('a point that fails again while flushing stays queued', async () => {
    const send = jest.fn().mockRejectedValue(new Error('still offline'));
    const wrapped = withRetryQueue(send);
    await expect(wrapped(P1)).rejects.toThrow();
    await expect(wrapped(P2)).rejects.toThrow();
    expect(queueLength()).toBe(2); // P1 (retried, failed again) + P2
  });

  it('caps the queue, dropping the oldest point so the most recent position survives', async () => {
    const send = jest.fn().mockRejectedValue(new Error('offline'));
    const wrapped = withRetryQueue(send);
    for (let i = 0; i < 25; i++) await expect(wrapped({ latitude: i, longitude: i })).rejects.toThrow();
    expect(queueLength()).toBe(20);
  });

  it('a point captured during a weak-signal spell reaches the server once the signal returns', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('weak signal')).mockResolvedValue(undefined);
    const wrapped = withRetryQueue(send);
    await expect(wrapped(P1)).rejects.toThrow(); // lost signal right here
    await wrapped(P2); // signal still weak when this one was taken... but succeeds
    await wrapped(P3);
    expect(send.mock.calls.map((c) => c[0])).toEqual([P1, P1, P2, P3]);
  });
});
