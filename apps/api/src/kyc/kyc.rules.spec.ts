import {
  ageInYears,
  extensionFor,
  isAdult,
  isMimeAllowed,
  isTypeAllowedForTier,
  isValidPastDate,
  missingDocuments,
} from './kyc.rules';

const today = new Date('2026-09-28T10:00:00Z');

describe('age', () => {
  it('birthday not yet reached this year: 17', () => {
    expect(ageInYears('2008-10-15', today)).toBe(17);
    expect(isAdult('2008-10-15', today)).toBe(false);
  });
  it('birthday today: 18 exactly, adult', () => {
    expect(ageInYears('2008-09-28', today)).toBe(18);
    expect(isAdult('2008-09-28', today)).toBe(true);
  });
  it('the day before turning 18 is still a minor', () => {
    expect(isAdult('2008-09-29', today)).toBe(false);
  });
  it('older adults', () => {
    expect(ageInYears('1990-01-01', today)).toBe(36);
  });
});

describe('isValidPastDate', () => {
  it.each([
    ['2001-02-30', false],
    ['2001-13-01', false],
    ['2999-01-01', false],
    ['1899-12-31', false],
    ['2000-02-29', true],
    ['1999-02-29', false],
  ])('%s -> %s', (d, ok) => expect(isValidPastDate(d, today)).toBe(ok));
});

describe('document rules', () => {
  it('tier 1 needs Aadhaar front, back and a selfie', () => {
    expect(missingDocuments(1, ['AADHAAR_FRONT'])).toEqual(['AADHAAR_BACK', 'SELFIE']);
    expect(missingDocuments(1, ['AADHAAR_FRONT', 'AADHAAR_BACK', 'SELFIE'])).toEqual([]);
  });
  it('tier 2 needs address proof', () => {
    expect(missingDocuments(2, [])).toEqual(['ADDRESS_PROOF']);
  });
  it('rejects document types that do not belong to the tier', () => {
    expect(isTypeAllowedForTier(1, 'SELFIE')).toBe(true);
    expect(isTypeAllowedForTier(1, 'ADDRESS_PROOF')).toBe(false);
    expect(isTypeAllowedForTier(2, 'SELFIE')).toBe(false);
  });
  it('identity photos must be images; address proof may be a PDF', () => {
    expect(isMimeAllowed('AADHAAR_FRONT', 'image/jpeg')).toBe(true);
    expect(isMimeAllowed('AADHAAR_FRONT', 'application/pdf')).toBe(false);
    expect(isMimeAllowed('ADDRESS_PROOF', 'application/pdf')).toBe(true);
    expect(isMimeAllowed('SELFIE', 'image/svg+xml')).toBe(false);
    expect(isMimeAllowed('SELFIE', 'IMAGE/PNG')).toBe(true);
  });
  it('maps mime to extension', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('application/pdf')).toBe('pdf');
    expect(extensionFor('x/y')).toBe('bin');
  });
});
