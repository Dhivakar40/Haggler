import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { getClientLeagueStatus } from '../../api/endpoints';
import { Card, ErrorState, LeagueBadge, Screen, Skeleton, Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

export const CLIENT_LEAGUE_STATUS_KEY = ['client-league-status'];

/** Part E (D-077), given real visual weight in Phase UI: see ranger/LeagueScreen.tsx — same
 * LeagueBadge-based treatment, the client ladder's own nine tiers and colors. */
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
        <View testID="client-league-skeleton" style={{ gap: spacing.lg }}>
          <Card>
            <View style={{ gap: spacing.sm, alignItems: 'center' }}>
              <Skeleton width="40%" height={14} />
              <Skeleton width="50%" height={32} radius={radii.pill} />
              <Skeleton width="70%" height={10} radius={radii.pill} />
            </View>
          </Card>
          <Card>
            <Skeleton width="60%" height={18} />
          </Card>
        </View>
      </Screen>
    );
  if (status.isError || !status.data)
    return (
      <Screen>
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      </Screen>
    );

  const s = status.data;
  const pct = Math.round(s.progress * 100);

  return (
    <Screen scroll>
      <Card testID="client-league-current">
        <View style={{ gap: spacing.md, alignItems: 'center' }}>
          <Text variant="label" color="textMuted">
            {t('clientLeague.currentLeague')}
          </Text>
          <LeagueBadge tier={s.league} kind="client" testID="client-league-name" />
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
            <View style={!rung.reached ? styles.dimmed : undefined}>
              <LeagueBadge tier={rung.tier} kind="client" size="sm" />
            </View>
            {rung.tier === s.league ? (
              <Text variant="label">{t('clientLeague.youAreHere')}</Text>
            ) : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: { height: 10, borderRadius: radii.pill, overflow: 'hidden', width: '100%' },
  fill: { height: '100%', borderRadius: radii.pill },
  rungRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dimmed: { opacity: 0.35 },
});
