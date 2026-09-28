import { parseDecisionForm } from './decision-form';

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe('parseDecisionForm', () => {
  it('tier 1 approval needs last 4 and a date of birth', () => {
    expect(parseDecisionForm(form({ decision: 'APPROVE' }), 1)).toEqual({
      ok: false,
      error: expect.stringContaining('last 4'),
    });
    expect(parseDecisionForm(form({ decision: 'APPROVE', aadhaarLast4: '4821' }), 1)).toEqual({
      ok: false,
      error: expect.stringContaining('date of birth'),
    });
    expect(
      parseDecisionForm(
        form({ decision: 'APPROVE', aadhaarLast4: '4821', dateOfBirth: '1995-06-14' }),
        1,
      ),
    ).toEqual({
      ok: true,
      payload: { decision: 'APPROVE', aadhaarLast4: '4821', dateOfBirth: '1995-06-14' },
    });
  });

  it('rejects malformed last 4 digits', () => {
    expect(
      parseDecisionForm(
        form({ decision: 'APPROVE', aadhaarLast4: '48x1', dateOfBirth: '1995-06-14' }),
        1,
      ).ok,
    ).toBe(false);
  });

  it('reject and request-info need a reason', () => {
    expect(parseDecisionForm(form({ decision: 'REJECT', reason: 'no' }), 1).ok).toBe(false);
    expect(
      parseDecisionForm(form({ decision: 'REQUEST_INFO', reason: 'Selfie is blurry' }), 1),
    ).toEqual({
      ok: true,
      payload: { decision: 'REQUEST_INFO', reason: 'Selfie is blurry' },
    });
  });

  it('tier 2 approval needs a VERIFIED reference call', () => {
    expect(parseDecisionForm(form({ decision: 'APPROVE' }), 2).ok).toBe(false);
    expect(
      parseDecisionForm(form({ decision: 'APPROVE', callOutcome: 'NOT_REACHABLE' }), 2).ok,
    ).toBe(false);
    expect(
      parseDecisionForm(
        form({ decision: 'APPROVE', callOutcome: 'VERIFIED', callNotes: 'Good' }),
        2,
      ),
    ).toEqual({
      ok: true,
      payload: { decision: 'APPROVE', referenceCall: { outcome: 'VERIFIED', notes: 'Good' } },
    });
  });

  it('tier 2 rejection can still log a negative call', () => {
    expect(
      parseDecisionForm(
        form({ decision: 'REJECT', reason: 'Reference was negative', callOutcome: 'NEGATIVE' }),
        2,
      ),
    ).toEqual({
      ok: true,
      payload: {
        decision: 'REJECT',
        reason: 'Reference was negative',
        referenceCall: { outcome: 'NEGATIVE' },
      },
    });
  });

  it('rejects an unknown decision', () => {
    expect(parseDecisionForm(form({ decision: 'DELETE_EVERYTHING' }), 1).ok).toBe(false);
  });
});
