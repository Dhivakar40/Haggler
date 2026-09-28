import type { KycDocumentTypeName } from '@haggler/shared';
import { MIN_ADULT_AGE } from '@haggler/shared';

/** Documents a Ranger must upload before a check can be submitted for review. */
export const REQUIRED_DOCUMENTS: Record<1 | 2, KycDocumentTypeName[]> = {
  1: ['AADHAAR_FRONT', 'AADHAAR_BACK', 'SELFIE'],
  2: ['ADDRESS_PROOF'],
};

export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Address proof may also be a PDF (e.g. a utility bill). Identity photos must be images. */
const MIME_BY_TYPE: Record<KycDocumentTypeName, readonly string[]> = {
  AADHAAR_FRONT: IMAGE_MIME,
  AADHAAR_BACK: IMAGE_MIME,
  SELFIE: IMAGE_MIME,
  ADDRESS_PROOF: [...IMAGE_MIME, 'application/pdf'],
  TRADE_LICENSE: [...IMAGE_MIME, 'application/pdf'],
};

export function isTypeAllowedForTier(tier: number, type: KycDocumentTypeName): boolean {
  return (REQUIRED_DOCUMENTS[tier as 1 | 2] ?? []).includes(type);
}

export function isMimeAllowed(type: KycDocumentTypeName, contentType: string): boolean {
  return MIME_BY_TYPE[type].includes(contentType.toLowerCase());
}

export function extensionFor(contentType: string): string {
  return (
    (
      {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'application/pdf': 'pdf',
      } as Record<string, string>
    )[contentType.toLowerCase()] ?? 'bin'
  );
}

export function missingDocuments(
  tier: 1 | 2,
  uploaded: KycDocumentTypeName[],
): KycDocumentTypeName[] {
  return REQUIRED_DOCUMENTS[tier].filter((t) => !uploaded.includes(t));
}

/**
 * Whole years between `dob` (YYYY-MM-DD) and `today`.
 * Trace: dob 2008-10-15, today 2026-09-28 -> 2026-2008 = 18, but the birthday (Oct 15) has not
 * happened yet this year, so age = 17 (under 18: blocked).
 */
export function ageInYears(dob: string, today: Date): number {
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/** True only for a real calendar date (rejects 2001-02-30) that is not in the future. */
export function isValidPastDate(dob: string, today: Date): boolean {
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return real && dt.getTime() <= today.getTime() && y >= 1900;
}

export const isAdult = (dob: string, today: Date): boolean =>
  ageInYears(dob, today) >= MIN_ADULT_AGE;
