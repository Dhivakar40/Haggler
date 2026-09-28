import {
  decodeCursor,
  encodeCursor,
  indianPhoneSchema,
  pincodeSchema,
  toPage,
  USER_FACING_ROLE_LABEL,
} from './index';

describe('schemas', () => {
  it('accepts valid Indian phone numbers and rejects others', () => {
    expect(indianPhoneSchema.safeParse('+919876543210').success).toBe(true);
    expect(indianPhoneSchema.safeParse('9876543210').success).toBe(false);
    expect(indianPhoneSchema.safeParse('+915876543210').success).toBe(false);
  });

  it('validates PIN codes', () => {
    expect(pincodeSchema.safeParse('600001').success).toBe(true);
    expect(pincodeSchema.safeParse('060001').success).toBe(false);
    expect(pincodeSchema.safeParse('6000').success).toBe(false);
  });
});

describe('terminology', () => {
  it('never shows "Worker" to users; the role is Ranger', () => {
    expect(USER_FACING_ROLE_LABEL.WORKER).toBe('Ranger');
    for (const label of Object.values(USER_FACING_ROLE_LABEL)) {
      expect(label.toLowerCase()).not.toContain('worker');
    }
  });
});

describe('cursor pagination', () => {
  it('round-trips a cursor', () => {
    const c = encodeCursor({ k: '2026-01-01T00:00:00.000Z', id: 'abc' });
    expect(decodeCursor(c)).toEqual({ k: '2026-01-01T00:00:00.000Z', id: 'abc' });
  });

  it('returns null for a tampered cursor', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from('{"x":1}').toString('base64url'))).toBeNull();
  });

  it('limit=2 with 3 rows gives 2 items and a cursor to the 2nd', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = toPage(rows, 2, (r) => ({ k: r.id, id: r.id }));
    expect(page.items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(decodeCursor(page.nextCursor as string)).toEqual({ k: 'b', id: 'b' });
  });

  it('has no cursor on the last page', () => {
    const page = toPage([{ id: 'a' }], 2, (r) => ({ k: r.id, id: r.id }));
    expect(page.nextCursor).toBeNull();
  });
});
