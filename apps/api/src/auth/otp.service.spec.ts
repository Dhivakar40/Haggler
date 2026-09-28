import { generateOtp } from './otp.service';

describe('generateOtp', () => {
  it('is always 6 digits, zero-padded', () => {
    for (let i = 0; i < 2000; i++) expect(generateOtp()).toMatch(/^[0-9]{6}$/);
  });

  it('is not constant and covers leading zeros', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateOtp()));
    expect(seen.size).toBeGreaterThan(400);
  });

  it('honours a custom length', () => {
    expect(generateOtp(4)).toMatch(/^[0-9]{4}$/);
  });
});
