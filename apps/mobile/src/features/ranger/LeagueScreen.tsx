import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { getLeagueStatus } from '../../api/endpoints';
import { Card, ErrorState, LeagueBadge, LoadingState, Screen, Skeleton, Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

export const LEAGUE_STATUS_KEY = ['league-status'];

/** Part D (D-076), given real visual weight in Phase UI: the current league shown as a
 * LeagueBadge (the same component the league-up popup and job screens use, so a Ranger's tier
 * always looks the same everywhere), and the ladder as a column of badges — reached tiers full
 * color, the rest dimmed — rather than a plain dot-and-text list. */
export function LeagueScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const status = useQuery({ queryKey: LEAGUE_STATUS_KEY, queryFn: getLeagueStatus });

  if (status.isLoading)
    return (
      <Screen>
        <View testID="league-skeleton" style={{ gap: spacing.lg }}>
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
        <ErrorState onRetry={() => void status.refetch()} />
      </Screen>
    );

  const s = status.data;
  const pct = Math.round(s.progress * 100);

  return (
    <Screen scroll>
      <Card testID="league-current">
        <View style={{ gap: spacing.md, alignItems: 'center' }}>
          <Text variant="label" color="textMuted">
            {t('league.currentLeague')}
          </Text>
          <LeagueBadge tier={s.league} kind="worker" testID="league-name" />
          {s.nextLeague ? (
            <>
              <View
                testID="league-progress-bar"
                style={[styles.track, { backgroundColor: colors.border }]}
              >
                <View
                  style={[
                    styles.fill,
                    { backgroundColor: colors.primary, width: `${pct}%` as const },
                  ]}
                />
              </View>
              <Text color="textMuted" testID="league-progress-label">
                {t('league.progressToNext', { pct, next: t(`league.tier.${s.nextLeague}`) })}
              </Text>
            </>
          ) : (
            <Text color="success">{t('league.atTop')}</Text>
          )}
        </View>
      </Card>

      <Card testID="league-stats">
        <View style={{ gap: spacing.xs }}>
          <Text variant="heading">{t('league.yourStats')}</Text>
          <Text color="textMuted">{t('league.jobsCompleted', { count: s.jobsCompleted })}</Text>
          <Text color="textMuted">
            {s.ratingAvg !== null
              ? t('league.ratingAvg', { avg: s.ratingAvg.toFixed(1), count: s.ratingCount })
              : t('league.noRatingsYet')}
          </Text>
        </View>
      </Card>

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('league.ladder')}</Text>
        {[...s.ladder].reverse().map((rung) => (
          <View key={rung.tier} style={styles.rungRow} testID={`ladder-${rung.tier}`}>
            <View style={!rung.reached ? styles.dimmed : undefined}>
              <LeagueBadge tier={rung.tier} kind="worker" size="sm" />
            </View>
            {rung.tier === s.league ? (
              <Text variant="label">{t('league.youAreHere')}</Text>
            ) : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 10,
    borderRadius: radii.pill,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
  rungRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dimmed: { opacity: 0.35 },
});
