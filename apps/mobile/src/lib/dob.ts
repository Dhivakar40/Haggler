/** Splits/joins a YYYY-MM-DD date of birth for a three-field (day/month/year) entry UI. */

export interface DobParts {
  day: string;
  month: string;
  year: string;
}

export function dobToParts(iso: string | null | undefined): DobParts {
  if (!iso) return { day: '', month: '', year: '' };
  const [y, m, d] = iso.split('-');
  return { day: d ?? '', month: m ?? '', year: y ?? '' };
}

/** Returns an ISO date string, or null if the parts don't form a real calendar date. */
export function partsToDob(parts: DobParts): string | null {
  const day = Number(parts.day);
  const month = Number(parts.month);
  const year = Number(parts.year);
  if (!day || !month || !year) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (String(year).length !== 4) return null;
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(iso);
  // Rejects e.g. 31 February, which Date would otherwise silently roll into March.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day)
    return null;
  const years = (Date.now() - date.getTime()) / (365.25 * 86_400_000);
  if (years < 5 || years > 120) return null;
  return iso;
}
