import { applicationStatusTone, listingStatusTone } from './status-tone';

describe('applicationStatusTone', () => {
  it.each([
    ['APPLIED', 'neutral'],
    ['SHORTLISTED', 'positive'],
    ['HIRED', 'positive'],
    ['REJECTED', 'negative'],
    ['WITHDRAWN', 'neutral'],
  ] as const)('%s -> %s', (status, tone) => {
    expect(applicationStatusTone(status)).toBe(tone);
  });
});

describe('listingStatusTone', () => {
  it.each([
    ['OPEN', 'positive'],
    ['PAUSED', 'neutral'],
    ['FILLED', 'neutral'],
    ['CLOSED', 'neutral'],
    ['CANCELLED', 'negative'],
  ] as const)('%s -> %s', (status, tone) => {
    expect(listingStatusTone(status)).toBe(tone);
  });
});
