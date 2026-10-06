import { Modal, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { elevatedShadow, radii, spacing } from '../theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

interface DialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel: string;
  onCancel: () => void;
  /** Routes the confirm button through Button's `danger` variant — for "Cancel job",
   * "Delete account", anything that can't be undone. */
  destructive?: boolean;
  testID?: string;
}

/** The app's one confirmation dialog, in the app's own visual language rather than the OS-styled
 * native Alert.alert the codebase used before Phase UI — same "ask first" moments (cancel a job,
 * sign out, delete an account), now drawn with the app's own tokens. */
export function Dialog({
  visible,
  title,
  message,
  confirmLabel,
  onConfirm,
  cancelLabel,
  onCancel,
  destructive = false,
  testID,
}: DialogProps) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View
          testID={testID}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading">{title}</Text>
            {message ? <Text color="textMuted">{message}</Text> : null}
          </View>
          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <Button
              testID={testID ? `${testID}-confirm` : undefined}
              title={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              onPress={onConfirm}
            />
            <Button
              testID={testID ? `${testID}-cancel` : undefined}
              title={cancelLabel}
              variant="secondary"
              onPress={onCancel}
            />
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
  card: { width: '100%', maxWidth: 360, borderRadius: radii.lg, borderWidth: 1, padding: spacing.xl, ...elevatedShadow },
});
