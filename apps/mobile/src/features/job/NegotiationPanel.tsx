import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';
import { MAX_NEGOTIATION_ROUNDS, type JobDto } from '@haggler/shared';
import { acceptOffer, counterOffer, makeOffer, rejectOffer } from '../../api/market';
import { Button, Card, Countdown, Text, TextField } from '../../components';
import { isOutsideBand, pendingOffer } from '../../lib/job-status';
import { formatRupees, parseRupeesToPaise } from '../../lib/money';
import { useNow } from '../../lib/useNow';
import { spacing } from '../../theme/tokens';
import type { useJobAction } from './useJobAction';

type Action = ReturnType<typeof useJobAction>;

/**
 * Price negotiation (D3): offer, counter, accept or reject; at most 3 rounds; offers expire; a price
 * outside the usual band needs an explicit "yes, continue" from BOTH people. The server enforces
 * every rule; this screen makes them visible and asks the confirmation before sending.
 */
export function NegotiationPanel({ job, action }: { job: JobDto; action: Action }) {
  const { t } = useTranslation();
  const now = useNow(1000);
  const [amount, setAmount] = useState('');
  const [invalid, setInvalid] = useState(false);
  const pending = pendingOffer(job, now);
  const mine = pending && pending.fromRole === job.viewerRole;
  const theirs = pending && pending.fromRole !== job.viewerRole;
  const rejected = job.offers.some((o) => o.status === 'REJECTED');
  const canOffer = !pending && !rejected && job.offers.length < MAX_NEGOTIATION_ROUNDS;
  const round = Math.min(MAX_NEGOTIATION_ROUNDS, job.offers.length + (pending ? 0 : 1)) || 1;
  const money = (p: number) => formatRupees(p);

  /** Ask before sending or accepting a price outside the band. */
  function confirmOutside(amountPaise: number, then: (confirmed: boolean) => void) {
    if (!isOutsideBand(amountPaise, job.band)) return then(false);
    Alert.alert(
      t('job.outsideTitle'),
      t('job.outsideBody', {
        amount: money(amountPaise),
        min: money(job.band.minPaise),
        max: money(job.band.maxPaise),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('job.continueAnyway'), onPress: () => then(true) },
      ],
    );
  }

  function confirmReject() {
    Alert.alert(t('job.rejectConfirmTitle'), t('job.rejectConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('job.reject'),
        style: 'destructive',
        onPress: () => void action.run('reject', () => rejectOffer(pending!.id)),
      },
    ]);
  }

  function send(kind: 'offer' | 'counter') {
    const paise = parseRupeesToPaise(amount);
    if (paise === null || paise < 100) return setInvalid(true);
    setInvalid(false);
    confirmOutside(
      paise,
      (confirmOutsideBand) =>
        void action
          .run(kind, () =>
            kind === 'counter' && pending
              ? counterOffer(pending.id, { amountPaise: paise, confirmOutsideBand })
              : makeOffer(job.id, { amountPaise: paise, confirmOutsideBand }),
          )
          .then((ok) => ok && setAmount('')),
    );
  }

  const amountField = (
    <TextField
      testID="offer-amount"
      label={t('job.yourOffer')}
      value={amount}
      onChangeText={setAmount}
      keyboardType="decimal-pad"
      maxLength={9}
      prefix="₹"
      error={invalid ? t('job.invalidAmount') : undefined}
    />
  );

  return (
    // Elevated only while there's a pending offer from the other side awaiting a reply — the
    // genuinely time-pressured moment (a countdown to expiry). Flat the rest of the time.
    <Card testID="negotiation" elevated={theirs}>
      <View style={{ gap: spacing.md }}>
        <Text variant="heading">{t('job.negotiate')}</Text>
        <Text testID="band" color="textMuted">
          {t('job.usualRange', { min: money(job.band.minPaise), max: money(job.band.maxPaise) })}
        </Text>
        <Text testID="round" variant="label">
          {t('job.round', { n: round })}
        </Text>

        {job.offers.map((o) => (
          <Text
            key={o.id}
            testID={`offer-${o.round}`}
            color={o.status === 'PENDING' ? 'text' : 'textMuted'}
          >
            {`${o.round}. ${o.fromRole === job.viewerRole ? t('job.customer').slice(0, 0) : ''}${money(o.amountPaise)}  ·  ${o.status}${o.outsideBand ? ' *' : ''}`}
          </Text>
        ))}

        {theirs ? (
          <View style={{ gap: spacing.sm }}>
            <Text testID="their-offer" variant="heading">
              {t('job.theyOffered', { amount: money(pending.amountPaise) })}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <Text color="textMuted">{t('job.offerExpires', { time: '' })}</Text>
              <Countdown until={pending.expiresAt} color="textMuted" />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Button
                testID="accept-offer"
                title={t('job.accept')}
                loading={action.busy === 'accept'}
                onPress={() =>
                  confirmOutside(
                    pending.amountPaise,
                    (confirmed) =>
                      void action.run('accept', () =>
                        acceptOffer(pending.id, confirmed || pending.outsideBand),
                      ),
                  )
                }
              />
              <Button
                testID="reject-offer"
                variant="danger"
                title={t('job.reject')}
                loading={action.busy === 'reject'}
                onPress={confirmReject}
              />
            </View>
            {job.offers.length < MAX_NEGOTIATION_ROUNDS ? (
              <>
                {amountField}
                <Button
                  testID="counter-offer"
                  variant="secondary"
                  title={t('job.counter')}
                  loading={action.busy === 'counter'}
                  onPress={() => send('counter')}
                />
              </>
            ) : null}
          </View>
        ) : null}

        {mine ? (
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
            <Text testID="my-offer" color="textMuted">
              {t('job.youOffered', { amount: money(pending.amountPaise) })}
            </Text>
            <Countdown until={pending.expiresAt} color="textMuted" />
          </View>
        ) : null}

        {canOffer ? (
          <>
            {amountField}
            <Button
              testID="send-offer"
              title={t('job.sendOffer')}
              loading={action.busy === 'offer'}
              onPress={() => send('offer')}
            />
          </>
        ) : null}
      </View>
    </Card>
  );
}
