import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, MAX_NEGOTIATION_ROUNDS } from '@haggler/shared';
import { CodedException } from '../common/http-errors';

export type Role = 'CUSTOMER' | 'WORKER';
export interface OfferLike {
  round: number;
  fromRole: Role;
  amountPaise: number;
  outsideBand: boolean;
  status: 'PENDING' | 'ACCEPTED' | 'COUNTERED' | 'REJECTED' | 'EXPIRED';
  expiresAt: Date;
}
export interface Band {
  minPaise: number;
  maxPaise: number;
}

const fail = (code: string, message: string, status = HttpStatus.CONFLICT) =>
  new CodedException(
    status,
    status === HttpStatus.UNPROCESSABLE_ENTITY ? ERROR_CODES.UNPROCESSABLE : ERROR_CODES.CONFLICT,
    message,
    { code },
  );

export const isOutsideBand = (amount: number, band: Band): boolean =>
  amount < band.minPaise || amount > band.maxPaise;

/** Latest offer that is still waiting for an answer (pending AND not expired). */
export function livePending(offers: OfferLike[], now: Date): OfferLike | undefined {
  return offers.find((o) => o.status === 'PENDING' && o.expiresAt > now);
}

/**
 * Negotiation rules (D3): at most 3 rounds, offers expire, the price stays inside the band unless
 * BOTH sides explicitly confirm.
 *
 * Trace (band 300..600, max 3 rounds):
 *   round 1  Ranger offers 500              -> pending
 *   round 2  customer counters 350          -> round 1 becomes COUNTERED, round 2 pending
 *   round 3  Ranger counters 450            -> round 2 COUNTERED, round 3 pending
 *   round 4  customer tries to counter      -> refused: limit reached; may only ACCEPT or REJECT round 3
 *   Outside the band: Ranger offers 800 without confirm -> refused. With confirm -> outsideBand=true,
 *   and the customer must also pass confirm to accept it.
 *
 * Returns the round number and outsideBand flag for a NEW offer, or throws.
 */
export function evaluateNewOffer(input: {
  offers: OfferLike[];
  role: Role;
  amountPaise: number;
  band: Band;
  confirmOutsideBand: boolean;
  now: Date;
}): { round: number; outsideBand: boolean; counters?: OfferLike } {
  const { offers, role, amountPaise, band, confirmOutsideBand, now } = input;

  if (offers.some((o) => o.status === 'REJECTED'))
    throw fail('NEGOTIATION_ENDED', 'This negotiation has ended.');
  const pending = livePending(offers, now);
  if (pending && pending.fromRole === role)
    throw fail('WAIT_FOR_RESPONSE', 'Wait for the other person to answer your offer.');

  const round = offers.length + 1;
  if (round > MAX_NEGOTIATION_ROUNDS)
    throw fail(
      'ROUND_LIMIT',
      `Negotiation is limited to ${MAX_NEGOTIATION_ROUNDS} rounds. Accept or reject the last offer.`,
    );

  const outsideBand = isOutsideBand(amountPaise, band);
  if (outsideBand && !confirmOutsideBand) {
    throw fail(
      'OUTSIDE_BAND_CONFIRMATION_REQUIRED',
      'This price is outside the usual range. Confirm to continue.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return { round, outsideBand, counters: pending };
}

/** May `role` accept this offer right now? Throws with the reason if not. */
export function assertCanRespond(
  offer: OfferLike | undefined,
  role: Role,
  now: Date,
  confirmOutsideBand: boolean,
): OfferLike {
  if (!offer) throw fail('NO_OFFER', 'There is no offer to respond to.');
  if (offer.status !== 'PENDING') throw fail('OFFER_CLOSED', 'That offer is no longer open.');
  if (offer.expiresAt <= now) throw fail('OFFER_EXPIRED', 'That offer has expired.');
  if (offer.fromRole === role) throw fail('OWN_OFFER', 'You cannot answer your own offer.');
  if (offer.outsideBand && !confirmOutsideBand) {
    throw fail(
      'OUTSIDE_BAND_CONFIRMATION_REQUIRED',
      'This price is outside the usual range. Confirm to accept it.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return offer;
}
