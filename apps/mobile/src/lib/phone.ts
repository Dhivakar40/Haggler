/**
 * Turns whatever a person typed into +91XXXXXXXXXX, or null if it cannot be an Indian mobile.
 * People paste "+91 98765 43210", "098765-43210", "91 9876543210", etc.
 * Trace: "+91 98765 43210" -> digits "919876543210" -> strip country code -> "9876543210" -> ok.
 */
export function normalizeIndianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits) ? `+91${digits}` : null;
}

/** "+919876543210" -> "+91 98765 43210" for display. */
export function formatIndianPhone(e164: string): string {
  const m = /^\+91([0-9]{5})([0-9]{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}
