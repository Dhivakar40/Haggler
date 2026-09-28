/**
 * Turns the review form into the API's decision payload. Kept as a pure function so the rules
 * (what each decision needs) are unit-tested and the server action stays thin. The API validates
 * again: this only gives the reviewer fast, clear messages.
 */
export type Decision = 'APPROVE' | 'REJECT' | 'REQUEST_INFO';

export interface DecisionPayload {
  decision: Decision;
  reason?: string;
  aadhaarLast4?: string;
  dateOfBirth?: string;
  referenceCall?: { outcome: 'VERIFIED' | 'NOT_REACHABLE' | 'NEGATIVE'; notes?: string };
}

export type ParseResult = { ok: true; payload: DecisionPayload } | { ok: false; error: string };

const text = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

export function parseDecisionForm(fd: FormData, tier: number): ParseResult {
  const decision = text(fd, 'decision') as Decision;
  if (!['APPROVE', 'REJECT', 'REQUEST_INFO'].includes(decision))
    return { ok: false, error: 'Choose a decision.' };

  const payload: DecisionPayload = { decision };
  const reason = text(fd, 'reason');
  if (reason) payload.reason = reason;

  if (decision !== 'APPROVE' && reason.length < 5) {
    return { ok: false, error: 'Write a reason of at least 5 characters. The Ranger will see it.' };
  }

  if (tier === 2) {
    const outcome = text(fd, 'callOutcome');
    if (outcome) {
      if (!['VERIFIED', 'NOT_REACHABLE', 'NEGATIVE'].includes(outcome))
        return { ok: false, error: 'Unknown call outcome.' };
      const notes = text(fd, 'callNotes');
      payload.referenceCall = {
        outcome: outcome as 'VERIFIED' | 'NOT_REACHABLE' | 'NEGATIVE',
        ...(notes ? { notes } : {}),
      };
    }
  }

  if (decision === 'APPROVE') {
    if (tier === 1) {
      const last4 = text(fd, 'aadhaarLast4');
      const dob = text(fd, 'dateOfBirth');
      if (!/^[0-9]{4}$/.test(last4))
        return { ok: false, error: 'Enter the last 4 digits of the Aadhaar number.' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob))
        return { ok: false, error: 'Enter the date of birth as shown on the Aadhaar.' };
      payload.aadhaarLast4 = last4;
      payload.dateOfBirth = dob;
    } else if (payload.referenceCall?.outcome !== 'VERIFIED') {
      return {
        ok: false,
        error: 'Log a successful reference call (outcome: Verified) before approving.',
      };
    }
  }
  return { ok: true, payload };
}
