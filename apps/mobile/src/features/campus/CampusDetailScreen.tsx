import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { applyToCampus, useCampusListing, withdrawFromCampus } from '../../api/campus';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../components';
import { errorMessage } from '../../lib/errors';
import { formatRupees } from '../../lib/money';
import { spacing } from '../../theme/tokens';

export function CampusDetailScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { id: listingId } = useLocalSearchParams<{ id: string }>();
  const listing = useCampusListing(listingId);
  const [coverNote, setCoverNote] = useState('');
  const [acceptsNightShift, setAcceptsNightShift] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['campus', listingId] });
  }

  async function apply() {
    setError(undefined);
    setBusy(true);
    try {
      await applyToCampus(listingId, {
        coverNote: coverNote.trim() || undefined,
        acceptsNightShift,
      });
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
      await withdrawFromCampus(listingId);
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
            {formatRupees(job.hourlyRatePaise)}/{t('campus.perHour')}
          </Text>
          <Text color="textMuted">
            {t('campus.hoursPerWeekShort', { hours: job.hoursPerWeek })}
          </Text>
          {job.isNightShift ? (
            <Text testID="campus-detail-night-shift" color="textMuted">
              {t('campus.nightShiftHint')}
            </Text>
          ) : null}
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
            <Text testID="my-campus-application-status">
              {t('employer.yourApplicationStatus', {
                status: t(`employer.applicationStatus.${status}`),
              })}
            </Text>
            {canWithdraw ? (
              <Button
                testID="withdraw-campus-application"
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
            {job.isNightShift ? (
              <View style={{ gap: spacing.xs }}>
                <Text variant="label">{t('campus.nightShiftOptIn')}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Chip
                    testID="night-shift-decline"
                    label={t('common.no')}
                    selected={!acceptsNightShift}
                    onPress={() => setAcceptsNightShift(false)}
                  />
                  <Chip
                    testID="night-shift-accept"
                    label={t('common.yes')}
                    selected={acceptsNightShift}
                    onPress={() => setAcceptsNightShift(true)}
                  />
                </View>
              </View>
            ) : null}
            <TextField
              testID="campus-cover-note"
              label={t('employer.coverNoteLabel')}
              value={coverNote}
              onChangeText={setCoverNote}
              multiline
              maxLength={1000}
            />
            <Button
              testID="apply-to-campus"
              title={t('employer.apply')}
              onPress={() => void apply()}
              loading={busy}
              disabled={job.isNightShift && !acceptsNightShift}
            />
          </View>
        </Card>
      ) : (
        <Text color="textMuted">{t('employer.listingNotOpen')}</Text>
      )}
    </Screen>
  );
}
