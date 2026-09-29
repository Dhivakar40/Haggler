/**
 * Money is integer paise everywhere. Format only at the edge, never do arithmetic on the string.
 * Indian digit grouping: 1,00,000 not 100,000. Trace: 3490050 paise -> ₹34,900.50 -> "₹34,900.50".
 * (Hermes' Intl support for en-IN varies by device, so this does not rely on it.)
 */
export function formatRupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const s = String(rupees);
  const grouped =
    s.length > 3 ? `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${s.slice(-3)}` : s;
  return `${sign}₹${grouped}${rem ? `.${String(rem).padStart(2, '0')}` : ''}`;
}

/** "349" or "349.50" typed by a person -> integer paise, or null if it is not a valid amount. */
export function parseRupeesToPaise(input: string): number | null {
  const t = input.trim().replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const [r, p = ''] = t.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
}
