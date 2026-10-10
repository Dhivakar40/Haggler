import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { JobDto } from '@haggler/shared';
import { acceptQuote, declineQuote } from '../../api/market';
import { useSession } from '../../auth/session';
import { Button, Card, StatusPill, Text } from '../../components';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';

/** Compatible with useJobAction's return shape, and with RequestStatusScreen's own lighter
 * run()/busy pair — both screens can host quotes (JobScreen for a Ranger who already quoted,
 * RequestStatusScreen for the customer choosing while still BROADCASTING). */
interface Action {
  busy: string | null;
  run: (name: string, fn: () => Promise<unknown>) => Promise<boolean>;
}

/**
 * D-080 (A4): "other"-category quotes while the job is still BROADCASTING. No counters, no
 * rounds — a Ranger sends one quote (see WorkScreen.tsx), the customer picks one here (which
 * performs the match) or declines it; a Ranger who already quoted sees their own quote's status.
 */
export function QuotesPanel({ job, action }: { job: JobDto; action: Action }) {
  const { t } = useTranslation();
  const userId = useSession((s) => s.user?.id);
  const isCustomer = job.viewerRole === 'CUSTOMER';
  const myQuote = !isCustomer ? job.quotes.find((q) => q.workerId === userId) : undefined;

  if (isCustomer) {
    if (job.quotes.length === 0) {
      return (
        <Card testID="quotes-panel">
          <Text color="textMuted">{t('job.quotesWaiting')}</Text>
        </Card>
      );
    }
    return (
      <Card testID="quotes-panel">
        <View style={{ gap: spacing.md }}>
          <Text variant="heading">{t('job.quotesReceived', { count: job.quotes.length })}</Text>
          {job.quotes.map((q) => (
            <View key={q.id} style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="heading">{formatRupees(q.amountPaise)}</Text>
                <StatusPill
                  tone={
                    q.status === 'ACCEPTED' ? 'positive' : q.status === 'DECLINED' ? 'neutral' : 'warning'
                  }
                  label={t(`job.quoteStatus.${q.status}`)}
                />
              </View>
              <Text color="textMuted">{q.workerFirstName ?? t('job.ranger')}</Text>
              {q.status === 'PENDING' ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button
                    testID={`accept-quote-${q.id}`}
                    title={t('job.acceptQuote')}
                    loading={action.busy === `accept-${q.id}`}
                    onPress={() => void action.run(`accept-${q.id}`, () => acceptQuote(job.id, q.id))}
                  />
                  <Button
                    testID={`decline-quote-${q.id}`}
                    variant="secondary"
                    title={t('job.declineQuote')}
                    loading={action.busy === `decline-${q.id}`}
                    onPress={() => void action.run(`decline-${q.id}`, () => declineQuote(job.id, q.id))}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </Card>
    );
  }

  // Ranger: can only be here (per the server's loadForParty rule) by having quoted already.
  return (
    <Card testID="quotes-panel">
      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('job.yourQuote')}</Text>
        {myQuote ? (
          <>
            <Text>{formatRupees(myQuote.amountPaise)}</Text>
            <StatusPill
              tone={
                myQuote.status === 'ACCEPTED'
                  ? 'positive'
                  : myQuote.status === 'DECLINED'
                    ? 'neutral'
                    : 'warning'
              }
              label={t(`job.quoteStatus.${myQuote.status}`)}
            />
          </>
        ) : (
          <Text color="textMuted">{t('job.quotesWaiting')}</Text>
        )}
      </View>
    </Card>
  );
}
