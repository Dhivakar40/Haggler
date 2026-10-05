import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { getClientLeagueStatus } from '../../api/endpoints';
import { Card, ErrorState, LoadingState, Screen, Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

export const CLIENT_LEAGUE_STATUS_KEY = ['client-league-status'];

/**
 * Part E (D-077): the customer-side mirror of the Ranger LeagueScreen — current league, progress,
 * and the full ladder, built on bookings + the ratings Rangers already leave for customers.
 * Functional only, same as the Ranger screen; Part H gives both their real visual treatment.
 */
export function ClientLeagueScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const status = useQuery({
    queryKey: CLIENT_LEAGUE_STATUS_KEY,
    queryFn: getClientLeagueStatus,
  });

  if (status.isLoading)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  if (status.isError || !status.data)
    return (
      <Screen>
        <ErrorState onRetry={() => void status.refetch()} />
      </Screen>
    );

  const s = status.data;
  const pct = Math.round(s.progress * 100);

  return (
    <Screen scroll>
      <Card testID="client-league-current">
        <View style={{ gap: spacing.sm }}>
          <Text variant="label" color="textMuted">
            {t('clientLeague.currentLeague')}
          </Text>
          <Text variant="title" testID="client-league-name">
            {t(`clientLeague.tier.${s.league}`)}
          </Text>
          {s.nextLeague ? (
            <>
              <View
                testID="client-league-progress-bar"
                style={[styles.track, { backgroundColor: colors.border }]}
              >
                <View
                  style={[
                    styles.fill,
                    { backgroundColor: colors.primary, width: `${pct}%` as const },
                  ]}
                />
              </View>
              <Text color="textMuted" testID="client-league-progress-label">
                {t('clientLeague.progressToNext', {
                  pct,
                  next: t(`clientLeague.tier.${s.nextLeague}`),
                })}
              </Text>
            </>
          ) : (
            <Text color="success">{t('clientLeague.atTop')}</Text>
          )}
        </View>
      </Card>

      <Card testID="client-league-stats">
        <View style={{ gap: spacing.xs }}>
          <Text variant="heading">{t('clientLeague.yourStats')}</Text>
          <Text color="textMuted">
            {t('clientLeague.bookingsCompleted', { count: s.bookingsCompleted })}
          </Text>
          <Text color="textMuted">
            {s.ratingAvg !== null
              ? t('clientLeague.ratingAvg', { avg: s.ratingAvg.toFixed(1), count: s.ratingCount })
              : t('clientLeague.noRatingsYet')}
          </Text>
        </View>
      </Card>

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('clientLeague.ladder')}</Text>
        {[...s.ladder].reverse().map((rung) => (
          <View key={rung.tier} style={styles.rungRow} testID={`client-ladder-${rung.tier}`}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: rung.reached ? colors.primary : colors.surface,
                  borderColor: rung.reached ? colors.primary : colors.border,
                },
              ]}
            />
            <Text style={rung.tier === s.league ? { fontWeight: '700' } : undefined}>
              {t(`clientLeague.tier.${rung.tier}`)}
              {rung.tier === s.league ? ` · ${t('clientLeague.youAreHere')}` : ''}
            </Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: { height: 10, borderRadius: radii.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radii.pill },
  rungRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
});
