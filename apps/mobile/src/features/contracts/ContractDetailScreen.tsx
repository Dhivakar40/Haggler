import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { applyToContract, useContract, withdrawFromContract } from '../../api/contracts';
import { Button, Card, ErrorState, LoadingState, Screen, Text, TextField } from '../../components';
import { errorMessage } from '../../lib/errors';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';

export function ContractDetailScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { id: listingId } = useLocalSearchParams<{ id: string }>();
  const listing = useContract(listingId);
  const [coverNote, setCoverNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['contracts', listingId] });
  }

  async function apply() {
    setError(undefined);
    setBusy(true);
    try {
      await applyToContract(listingId, coverNote.trim() ? { coverNote: coverNote.trim() } : {});
      await refresh();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setError(undefined);
    setBusy(true);
    try {
      await withdrawFromContract(listingId);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (listing.isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (listing.isError || !listing.data)
    return (
      <Screen>
        <ErrorState onRetry={() => void listing.refetch()} />
      </Screen>
    );

  const job = listing.data;
  const status = job.myApplicationStatus;
  const canApply = job.status === 'OPEN' && (!status || status === 'WITHDRAWN');
  const canWithdraw = status === 'APPLIED' || status === 'SHORTLISTED';

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xs }}>
        <Text variant="title">{job.title}</Text>
        <Text color="textMuted">
          {job.businessName} · {t(`categories.${job.categorySlug}`)}
        </Text>
      </View>

      <Card>
        <View style={{ gap: spacing.sm }}>
          <Text>{job.description}</Text>
          <Text color="textMuted">
            {job.city}, {job.state} · {job.pincode}
          </Text>
          <Text variant="heading">
            {formatRupees(job.payAmountPaise)} / {t(`employer.payTypes.${job.payType}`)}
          </Text>
          <Text color="textMuted">
            {t('employer.filledOf', { filled: job.filledCount, openings: job.openings })}
          </Text>
        </View>
      </Card>

      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {status ? (
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text testID="my-application-status">
              {t('employer.yourApplicationStatus', {
                status: t(`employer.applicationStatus.${status}`),
              })}
            </Text>
            {canWithdraw ? (
              <Button
                testID="withdraw-application"
                variant="danger"
                title={t('employer.withdraw')}
                onPress={() => void withdraw()}
                loading={busy}
              />
            ) : null}
          </View>
        </Card>
      ) : canApply ? (
        <Card>
          <View style={{ gap: spacing.sm }}>
            <TextField
              testID="cover-note"
              label={t('employer.coverNoteLabel')}
              value={coverNote}
              onChangeText={setCoverNote}
              multiline
              maxLength={1000}
            />
            <Button
              testID="apply-to-contract"
              title={t('employer.apply')}
              onPress={() => void apply()}
              loading={busy}
            />
          </View>
        </Card>
      ) : (
        <Text color="textMuted">{t('employer.listingNotOpen')}</Text>
      )}
    </Screen>
  );
}
