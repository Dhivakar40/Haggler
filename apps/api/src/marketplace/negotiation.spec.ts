import {
  assertCanRespond,
  evaluateNewOffer,
  isOutsideBand,
  livePending,
  type OfferLike,
} from './negotiation';

const band = { minPaise: 30000, maxPaise: 60000 };
const now = new Date('2026-09-30T10:00:00Z');
const later = new Date('2026-09-30T10:05:00Z');
const earlier = new Date('2026-09-30T09:00:00Z');
const offer = (o: Partial<OfferLike>): OfferLike => ({
  round: 1,
  fromRole: 'WORKER',
  amountPaise: 50000,
  outsideBand: false,
  status: 'PENDING',
  expiresAt: later,
  ...o,
});
const evalOffer = (
  offers: OfferLike[],
  role: 'CUSTOMER' | 'WORKER',
  amountPaise: number,
  confirm = false,
) => evaluateNewOffer({ offers, role, amountPaise, band, confirmOutsideBand: confirm, now });

describe('price band', () => {
  it('is inclusive at both ends', () => {
    expect(isOutsideBand(30000, band)).toBe(false);
    expect(isOutsideBand(60000, band)).toBe(false);
    expect(isOutsideBand(29999, band)).toBe(true);
    expect(isOutsideBand(60001, band)).toBe(true);
  });
});

describe('evaluateNewOffer', () => {
  it('the first offer is round 1, from either side', () => {
    expect(evalOffer([], 'WORKER', 50000)).toMatchObject({ round: 1, outsideBand: false });
    expect(evalOffer([], 'CUSTOMER', 40000)).toMatchObject({ round: 1 });
  });

  it('a counter is round 2 and points at the offer it answers', () => {
    const r1 = offer({});
    const res = evalOffer([r1], 'CUSTOMER', 35000);
    expect(res.round).toBe(2);
    expect(res.counters).toBe(r1);
  });

  it('you cannot offer again while your own offer is waiting', () => {
    expect(() => evalOffer([offer({ fromRole: 'WORKER' })], 'WORKER', 45000)).toThrow(
      /Wait for the other person/,
    );
  });

  it('after your own offer EXPIRED you may offer again (it used a round)', () => {
    const expired = offer({ status: 'EXPIRED', expiresAt: earlier });
    expect(evalOffer([expired], 'WORKER', 45000).round).toBe(2);
  });

  it('an expired-but-still-marked-PENDING offer does not block a new offer', () => {
    const stale = offer({ status: 'PENDING', expiresAt: earlier });
    expect(evalOffer([stale], 'WORKER', 45000).round).toBe(2);
  });

  it('round 4 is refused: the limit is 3', () => {
    const offers = [
      offer({ round: 1, status: 'COUNTERED', fromRole: 'WORKER' }),
      offer({ round: 2, status: 'COUNTERED', fromRole: 'CUSTOMER' }),
      offer({ round: 3, status: 'PENDING', fromRole: 'WORKER' }),
    ];
    expect(() => evalOffer(offers, 'CUSTOMER', 40000)).toThrow(/limited to 3 rounds/);
  });

  it('nothing can be offered after a rejection', () => {
    expect(() => evalOffer([offer({ status: 'REJECTED' })], 'CUSTOMER', 40000)).toThrow(
      /has ended/,
    );
  });

  it('outside the band needs explicit confirmation; with it, the offer is flagged', () => {
    expect(() => evalOffer([], 'WORKER', 80000)).toThrow(/outside the usual range/);
    expect(evalOffer([], 'WORKER', 80000, true)).toMatchObject({ outsideBand: true });
    expect(() => evalOffer([], 'CUSTOMER', 10000)).toThrow(/outside the usual range/);
  });
});

describe('assertCanRespond', () => {
  it('the other party can accept a live offer', () => {
    const o = offer({ fromRole: 'WORKER' });
    expect(assertCanRespond(o, 'CUSTOMER', now, false)).toBe(o);
  });
  it('refuses your own offer, closed offers, expired offers, and a missing offer', () => {
    expect(() => assertCanRespond(offer({ fromRole: 'WORKER' }), 'WORKER', now, false)).toThrow(
      /own offer/,
    );
    expect(() => assertCanRespond(offer({ status: 'ACCEPTED' }), 'CUSTOMER', now, false)).toThrow(
      /no longer open/,
    );
    expect(() => assertCanRespond(offer({ expiresAt: earlier }), 'CUSTOMER', now, false)).toThrow(
      /expired/,
    );
    expect(() => assertCanRespond(undefined, 'CUSTOMER', now, false)).toThrow(/no offer/);
  });
  it('accepting an out-of-band offer needs the accepter to confirm too', () => {
    const o = offer({ outsideBand: true, amountPaise: 80000 });
    expect(() => assertCanRespond(o, 'CUSTOMER', now, false)).toThrow(/Confirm to accept/);
    expect(assertCanRespond(o, 'CUSTOMER', now, true)).toBe(o);
  });
});

describe('livePending', () => {
  it('finds only pending, unexpired offers', () => {
    expect(livePending([offer({ status: 'ACCEPTED' })], now)).toBeUndefined();
    expect(livePending([offer({ expiresAt: earlier })], now)).toBeUndefined();
    expect(livePending([offer({})], now)).toBeDefined();
  });
});
