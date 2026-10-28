import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cancelDeletion } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Text } from '../../components';
import { errorMessage } from '../../lib/errors';
import { showToast } from '../../store/toast-queue';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

/**
 * D-108: while an account is in its 48-hour deletion grace period it stays fully usable (see
 * `UsersService.requestDeletion`) — this is the one visible sign of it, shown above every screen.
 * Tapping it cancels the deletion outright; there is nothing else to confirm, since the person
 * can always request deletion again if they tap it by mistake.
 */
export function DeletionBanner() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const scheduledFor = useSession((s) => s.user?.deletionScheduledFor ?? null);
  const refreshMe = useSession((s) => s.refreshMe);
  const [busy, setBusy] = useState(false);

  if (!scheduledFor) return null;

  async function cancel() {
    setBusy(true);
    try {
      await cancelDeletion();
      await refreshMe();
      showToast(t('deleteAccount.cancelledToast'), 'success');
    } catch (err) {
      showToast(errorMessage(err, t), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: colors.danger }}>
      <Pressable
        testID="deletion-banner"
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void cancel()}
        style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}
      >
        <Text style={{ color: colors.onDanger }} variant="caption">
          {t('deleteAccount.scheduledBanner')}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}
