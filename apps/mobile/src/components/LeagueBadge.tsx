import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { ClientLeagueTier, LeagueTier } from '@haggler/shared';
import { leagueColors, radii, spacing } from '../theme/tokens';
import { Text } from './Text';

interface LeagueBadgeProps {
  tier: LeagueTier | ClientLeagueTier;
  /** Which ladder `tier` belongs to — picks the translation namespace (league.tier.* vs
   * clientLeague.tier.*). The two ladders share some tier-color values (see tokens.ts) but never
   * share tier names, so this is required, not inferred. */
  kind: 'worker' | 'client';
  size?: 'sm' | 'md';
  testID?: string;
}

/** The one league-tier pill for the whole app — covers all nine Ranger tiers and all nine client
 * tiers via tokens.ts's leagueColors. Used on the league screens, the league-up popup, and
 * anywhere else a league needs to be shown inline (e.g. a Ranger's card in a job list). */
export function LeagueBadge({ tier, kind, size = 'md', testID }: LeagueBadgeProps) {
  const { t } = useTranslation();
  const c = leagueColors[tier];
  if (!c) return null; // an unrecognized tier renders nothing rather than a broken/blank pill
  const label = t(kind === 'worker' ? `league.tier.${tier}` : `clientLeague.tier.${tier}`);
  return (
    <View
      testID={testID}
      style={[
        styles.badge,
        size === 'sm' ? styles.sm : styles.md,
        { backgroundColor: c.bg },
      ]}
    >
      <Text variant={size === 'sm' ? 'caption' : 'label'} style={{ color: c.on }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: radii.pill },
  sm: { paddingHorizontal: spacing.sm, paddingVertical: 2 },
  md: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
});
