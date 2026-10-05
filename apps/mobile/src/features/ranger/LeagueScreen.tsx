import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { getLeagueStatus } from '../../api/endpoints';
import { Card, ErrorState, LoadingState, Screen, Text } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

export const LEAGUE_STATUS_KEY = ['league-status'];

/**
 * Part D (D-076): current league, progress toward the next, and the full ladder. Functional only
 * — this is the screen Part H (sub-phase 5) gives real visual weight (progress rings, league
 * badges/icons), per the plan's "show key screens before applying app-wide" step. For now it uses
 * the existing token system and a plain percentage bar, same spirit as the onboarding screen.
 */
export function LeagueScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const status = useQuery({ queryKey: LEAGUE_STATUS_KEY, queryFn: getLeagueStatus });

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
      <Card testID="league-current">
        <View style={{ gap: spacing.sm }}>
          <Text variant="label" color="textMuted">
            {t('league.currentLeague')}
          </Text>
          <Text variant="title" testID="league-name">
            {t(`league.tier.${s.league}`)}
          </Text>
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
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: rung.reached ? colors.primary : colors.surface,
                  borderColor: rung.reached ? colors.primary : colors.border,
                },
              ]}
            />
            <Text
              color={rung.tier === s.league ? 'text' : rung.reached ? 'textMuted' : 'textMuted'}
              style={rung.tier === s.league ? { fontWeight: '700' } : undefined}
            >
              {t(`league.tier.${rung.tier}`)}
              {rung.tier === s.league ? ` · ${t('league.youAreHere')}` : ''}
            </Text>
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
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
  },
});
