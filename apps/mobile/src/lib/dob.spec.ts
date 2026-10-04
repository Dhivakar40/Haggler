import { dobToParts, partsToDob } from './dob';

describe('dobToParts / partsToDob', () => {
  it('round-trips a valid date', () => {
    expect(dobToParts('1995-07-04')).toEqual({ day: '04', month: '07', year: '1995' });
    expect(partsToDob({ day: '04', month: '07', year: '1995' })).toBe('1995-07-04');
  });

  it('returns empty parts for null/undefined', () => {
    expect(dobToParts(null)).toEqual({ day: '', month: '', year: '' });
    expect(dobToParts(undefined)).toEqual({ day: '', month: '', year: '' });
  });

  it('rejects an impossible calendar date (31 February)', () => {
    expect(partsToDob({ day: '31', month: '02', year: '1995' })).toBeNull();
  });

  it('rejects an out-of-range month or day', () => {
    expect(partsToDob({ day: '10', month: '13', year: '1995' })).toBeNull();
    expect(partsToDob({ day: '32', month: '01', year: '1995' })).toBeNull();
  });

  it('rejects someone implausibly young or old', () => {
    const thisYear = new Date().getFullYear();
    expect(partsToDob({ day: '01', month: '01', year: String(thisYear - 1) })).toBeNull();
    expect(partsToDob({ day: '01', month: '01', year: String(thisYear - 150) })).toBeNull();
  });

  it('rejects incomplete parts', () => {
    expect(partsToDob({ day: '04', month: '07', year: '' })).toBeNull();
    expect(partsToDob({ day: '', month: '', year: '' })).toBeNull();
  });
});
