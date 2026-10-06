import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { elevatedShadow, radii, spacing } from '../theme/tokens';
import { useLeagueUpQueue } from '../store/league-up-queue';
import { Button } from './Button';
import { Text } from './Text';

/**
 * Sub-phase 4, Part F: the celebration popup for a league-up, queued by lib/league-up-check.ts.
 * Shows one event at a time; dismissing advances to the next queued one, if any. Purely a reaction
 * to local state (the queue) — no fetch of its own, so it's cheap to mount globally once.
 */
export function LeagueUpModal() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const event = useLeagueUpQueue((s) => s.queue[0]);
  const shift = useLeagueUpQueue((s) => s.shift);

  if (!event) return null;

  const leagueName = t(
    event.kind === 'worker' ? `league.tier.${event.league}` : `clientLeague.tier.${event.league}`,
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={shift}>
      <View style={styles.backdrop}>
        <View
          testID="league-up-modal"
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.primary }]}
        >
          <View style={{ gap: spacing.sm, alignItems: 'center' }}>
            <Text variant="title" testID="league-up-title">
              {t('leagueUp.title')}
            </Text>
            <Text testID="league-up-body" style={{ textAlign: 'center' }}>
              {t(event.kind === 'worker' ? 'leagueUp.workerBody' : 'leagueUp.clientBody', {
                league: leagueName,
              })}
            </Text>
            <View style={{ gap: spacing.sm, width: '100%', marginTop: spacing.md }}>
              <Button
                testID="league-up-view"
                title={t('leagueUp.viewLeague')}
                onPress={() => {
                  shift();
                  router.push(event.kind === 'worker' ? '/league' : '/client-league');
                }}
              />
              <Button
                testID="league-up-dismiss"
                variant="secondary"
                title={t('leagueUp.dismiss')}
                onPress={shift}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xl,
    ...elevatedShadow,
  },
});
