import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { unblockUser, useBlocks } from '../../api/reputation';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components';
import { errorMessage } from '../../lib/errors';
import { spacing } from '../../theme/tokens';

/** Everyone I've blocked, with a way to undo it. */
export function BlockedUsersScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useBlocks();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  async function unblock(userId: string) {
    setBusyId(userId);
    setError(undefined);
    try {
      await unblockUser(userId);
      await qc.invalidateQueries({ queryKey: ['blocks'] });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (isError || !data)
    return (
      <Screen>
        <ErrorState onRetry={() => void refetch()} />
      </Screen>
    );

  return (
    <Screen scroll>
      <Text variant="title">{t('account.blockedUsers')}</Text>
      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {data.length === 0 ? <EmptyState message={t('account.noBlockedUsers')} /> : null}
      {data.map((b) => (
        <Card key={b.userId} testID={`blocked-${b.userId}`}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: spacing.sm,
            }}
          >
            <View style={{ gap: 2, flex: 1 }}>
              <Text variant="heading">{b.firstName ?? '—'}</Text>
              {b.reason ? <Text color="textMuted">{b.reason}</Text> : null}
            </View>
            <Button
              testID={`unblock-${b.userId}`}
              variant="secondary"
              title={t('account.unblock')}
              loading={busyId === b.userId}
              onPress={() => void unblock(b.userId)}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
