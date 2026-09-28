import { type PriceBandRow, pincodeCluster, resolvePriceBand } from './price-band.resolver';

const def: PriceBandRow = {
  scope: 'DEFAULT',
  city: null,
  pincodePrefix: null,
  minPaise: 19900,
  medianPaise: 34900,
  maxPaise: 59900,
  sampleSize: 0,
};
const city = (n: number): PriceBandRow => ({
  scope: 'CITY',
  city: 'Chennai',
  pincodePrefix: null,
  minPaise: 25000,
  medianPaise: 40000,
  maxPaise: 70000,
  sampleSize: n,
});
const cluster = (n: number): PriceBandRow => ({
  scope: 'PINCODE_CLUSTER',
  city: null,
  pincodePrefix: '600',
  minPaise: 30000,
  medianPaise: 45000,
  maxPaise: 80000,
  sampleSize: n,
});

const input = { categorySlug: 'electrician', pincode: '600042', city: 'Chennai', minSample: 10 };

describe('pincodeCluster', () => {
  it('is the first three digits', () => expect(pincodeCluster('600042')).toBe('600'));
});

describe('resolvePriceBand', () => {
  it('prefers a trusted pincode-cluster band over city and default', () => {
    const r = resolvePriceBand(input, [def, city(31), cluster(12)]);
    expect(r?.scope).toBe('PINCODE_CLUSTER');
    expect(r?.medianPaise).toBe(45000);
    expect(r?.isSeededDefault).toBe(false);
  });

  it('skips a thin cluster and falls back to the city', () => {
    const r = resolvePriceBand(input, [def, city(31), cluster(4)]);
    expect(r?.scope).toBe('CITY');
  });

  it('falls back to the seeded default when both are thin', () => {
    const r = resolvePriceBand(input, [def, city(9), cluster(4)]);
    expect(r?.scope).toBe('DEFAULT');
    expect(r?.isSeededDefault).toBe(true);
  });

  it('treats the threshold as inclusive', () => {
    expect(resolvePriceBand(input, [def, city(10)])?.scope).toBe('CITY');
  });

  it('matches city case-insensitively', () => {
    const r = resolvePriceBand({ ...input, pincode: undefined, city: 'chennai' }, [def, city(20)]);
    expect(r?.scope).toBe('CITY');
  });

  it('uses the default when no location is given', () => {
    const r = resolvePriceBand({ categorySlug: 'electrician', minSample: 10 }, [
      def,
      city(50),
      cluster(50),
    ]);
    expect(r?.scope).toBe('DEFAULT');
  });

  it('returns null when nothing exists', () => {
    expect(resolvePriceBand(input, [])).toBeNull();
  });
});
