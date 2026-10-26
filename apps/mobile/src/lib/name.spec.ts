import { firstName } from './name';

describe('firstName', () => {
  it('takes the first word of a full name', () => {
    expect(firstName('Asha Raman')).toBe('Asha');
  });

  it('a single-word name is returned as-is', () => {
    expect(firstName('Asha')).toBe('Asha');
  });

  it('null/undefined/empty all fall back to null, never "Hi null"', () => {
    expect(firstName(null)).toBeNull();
    expect(firstName(undefined)).toBeNull();
    expect(firstName('')).toBeNull();
    expect(firstName('   ')).toBeNull();
  });

  it('trims stray whitespace', () => {
    expect(firstName('  Asha   Raman  ')).toBe('Asha');
  });
});
