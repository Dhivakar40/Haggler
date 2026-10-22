/** Simple structural check — the server does the real validation (zod's `.email()`). Just
 * enough here to avoid an obviously-wrong submission round-trip. */
export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}
