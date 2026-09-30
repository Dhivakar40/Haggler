import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, View } from 'react-native';
import type { ContractDecisionInput } from '@haggler/shared';
import {
  boostListing,
  decideOnApplication,
  updateListing,
  useContract,
  useListingApplications,
} from '../../api/contracts';
import { sandboxPay } from '../../api/wallet';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { errorMessage } from '../../lib/errors';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';

const STATUS_COLOR: Record<string, 'text' | 'success' | 'danger' | 'textMuted'> = {
  APPLIED: 'text',
  SHORTLISTED: 'success',
  REJECTED: 'danger',
  HIRED: 'success',
  WITHDRAWN: 'textMuted',
};

export function ListingApplicantsScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { id: listingId } = useLocalSearchParams<{ id: string }>();
  const listing = useContract(listingId);
  const applications = useListingApplications(listingId);
  const [busyId, setBusyId] = useState<string>();
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string>();

  async function closeListing() {
    setError(undefined);
    setClosing(true);
    try {
      await updateListing(listingId, { status: 'CLOSED' });
      await qc.invalidateQueries({ queryKey: ['contracts', listingId] });
      await qc.invalidateQueries({ queryKey: ['employer', 'listings'] });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setClosing(false);
    }
  }

  /** Boosted listing fee (Phase 9, D-069). */
  async function boost() {
    setError(undefined);
    setClosing(true);
    try {
      const order = await boostListing(listingId);
      if (order.provider === 'sandbox') {
        Alert.alert(
          t('monetization.boostButton'),
          t('monetization.boostSummary', {
            amount: formatRupees(order.amountPaise),
            days: 7,
          }),
          [
            { text: t('monetization.cancel'), style: 'cancel', onPress: () => setClosing(false) },
            {
              text: t('monetization.payNow'),
              onPress: () =>
                void (async () => {
                  try {
                    await sandboxPay(order.orderId);
                    await qc.invalidateQueries({ queryKey: ['contracts', listingId] });
                    Alert.alert(t('monetization.boostDone'));
                  } catch (err) {
                    setError(errorMessage(err, t));
                  } finally {
                    setClosing(false);
                  }
                })(),
            },
          ],
        );
      } else {
        setError(t('wallet.razorpayPending'));
        setClosing(false);
      }
    } catch (err) {
      setError(errorMessage(err, t));
      setClosing(false);
    }
  }

  async function decide(applicationId: string, decision: ContractDecisionInput['decision']) {
    setError(undefined);
    setBusyId(applicationId);
    try {
      await decideOnApplication(listingId, applicationId, { decision });
      await qc.invalidateQueries({ queryKey: ['employer', 'listings', listingId, 'applications'] });
      await qc.invalidateQueries({ queryKey: ['employer', 'listings'] });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusyId(undefined);
    }
  }

  function confirmHire(applicationId: string, workerName: string | null) {
    Alert.alert(
      t('employer.confirmHireTitle'),
      t('employer.confirmHireBody', { name: workerName ?? t('employer.anApplicant') }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('employer.hire'), onPress: () => void decide(applicationId, 'HIRE') },
      ],
    );
  }

  if (applications.isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (applications.isError)
    return (
      <Screen>
        <ErrorState onRetry={() => void applications.refetch()} />
      </Screen>
    );

  const items = applications.data?.items ?? [];

  return (
    <Screen>
      {listing.data ? (
        <Card>
          <View style={{ gap: spacing.xs }}>
            <Text variant="heading">{listing.data.title}</Text>
            <Text color="textMuted">
              {t('employer.filledOf', {
                filled: listing.data.filledCount,
                openings: listing.data.openings,
              })}{' '}
              · {t(`employer.listingStatus.${listing.data.status}`)}
            </Text>
            {listing.data.status === 'OPEN' && !listing.data.isBoosted ? (
              <Button
                testID="boost-listing"
                variant="secondary"
                title={t('monetization.boostButton')}
                onPress={() => void boost()}
                loading={closing}
              />
            ) : null}
            {listing.data.status === 'OPEN' || listing.data.status === 'PAUSED' ? (
              <Button
                testID="close-listing"
                variant="secondary"
                title={t('employer.closeListing')}
                onPress={() => void closeListing()}
                loading={closing}
              />
            ) : null}
          </View>
        </Card>
      ) : null}
      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {items.length === 0 ? (
        <EmptyState message={t('employer.noApplicants')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.md }}
          renderItem={({ item }) => {
            const decidable = item.status === 'APPLIED' || item.status === 'SHORTLISTED';
            return (
              <Card testID={`applicant-${item.id}`}>
                <View style={{ gap: spacing.sm }}>
                  <Text variant="heading">{item.workerName ?? t('employer.anApplicant')}</Text>
                  {item.coverNote ? <Text color="textMuted">{item.coverNote}</Text> : null}
                  <Text color={STATUS_COLOR[item.status] ?? 'text'}>
                    {t(`employer.applicationStatus.${item.status}`)}
                  </Text>
                  {decidable ? (
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      {item.status === 'APPLIED' ? (
                        <Button
                          testID={`shortlist-${item.id}`}
                          variant="secondary"
                          title={t('employer.shortlist')}
                          onPress={() => void decide(item.id, 'SHORTLIST')}
                          loading={busyId === item.id}
                        />
                      ) : null}
                      <Button
                        testID={`reject-${item.id}`}
                        variant="secondary"
                        title={t('employer.reject')}
                        onPress={() => void decide(item.id, 'REJECT')}
                        loading={busyId === item.id}
                      />
                      <Button
                        testID={`hire-${item.id}`}
                        title={t('employer.hire')}
                        onPress={() => confirmHire(item.id, item.workerName)}
                        loading={busyId === item.id}
                      />
                    </View>
                  ) : null}
                </View>
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}
