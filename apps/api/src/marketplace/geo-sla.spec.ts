import { haversineMeters } from './geo';
import { estimateAcceptMinutes } from './sla';

describe('haversineMeters', () => {
  it('Chennai Central to Marina Beach is about 3.8 km', () => {
    const d = haversineMeters(
      { latitude: 13.0827, longitude: 80.2707 },
      { latitude: 13.05, longitude: 80.2824 },
    );
    expect(d).toBeGreaterThan(3600);
    expect(d).toBeLessThan(4000);
  });
  it('is zero for the same point, and symmetric', () => {
    const a = { latitude: 12.97, longitude: 80.22 };
    const b = { latitude: 13.0, longitude: 80.3 };
    expect(haversineMeters(a, a)).toBe(0);
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
  it('100 m north is about 100 m', () => {
    expect(
      haversineMeters(
        { latitude: 12.97, longitude: 80.22 },
        { latitude: 12.970899, longitude: 80.22 },
      ),
    ).toBeCloseTo(100, -1);
  });
});

describe('estimateAcceptMinutes', () => {
  const opts = { minSamples: 5, defaultMinutes: 4 };
  it('uses the local median, rounded up: [120,300,180,240,600] -> 4 min', () => {
    expect(
      estimateAcceptMinutes({
        ...opts,
        localSeconds: [120, 300, 180, 240, 600],
        categorySeconds: [],
      }),
    ).toEqual({ minutes: 4, source: 'LOCAL' });
  });
  it('rounds up so we under-promise (90 s -> 2 min)', () => {
    expect(
      estimateAcceptMinutes({ ...opts, localSeconds: [90, 90, 90, 90, 90], categorySeconds: [] })
        .minutes,
    ).toBe(2);
  });
  it('never says 0 minutes', () => {
    expect(
      estimateAcceptMinutes({ ...opts, localSeconds: [5, 5, 5, 5, 5], categorySeconds: [] })
        .minutes,
    ).toBe(1);
  });
  it('falls back to the category, then to the default when data is thin', () => {
    expect(
      estimateAcceptMinutes({
        ...opts,
        localSeconds: [60],
        categorySeconds: [600, 600, 600, 600, 600],
      }),
    ).toEqual({ minutes: 10, source: 'CATEGORY' });
    expect(estimateAcceptMinutes({ ...opts, localSeconds: [60], categorySeconds: [60] })).toEqual({
      minutes: 4,
      source: 'DEFAULT',
    });
  });
  it('the median resists one huge outlier', () => {
    expect(
      estimateAcceptMinutes({
        ...opts,
        localSeconds: [120, 120, 120, 120, 86_400],
        categorySeconds: [],
      }).minutes,
    ).toBe(2);
  });
});
