/** "Asha Raman" -> "Asha". Null/empty stays null — callers fall back to a generic greeting
 * rather than ever showing "Hi null" or "Hi ". */
export function firstName(fullName: string | null | undefined): string | null {
  const trimmed = fullName?.trim();
  return trimmed ? (trimmed.split(/\s+/)[0] ?? null) : null;
}
