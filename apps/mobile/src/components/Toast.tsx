import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useToastQueue } from '../store/toast-queue';
import { elevatedShadow, motion, radii, spacing } from '../theme/tokens';
import { Text } from './Text';

const VISIBLE_MS = 2800;

/** The app's one toast surface, mounted once globally (see app/_layout.tsx) — call `showToast()`
 * from `store/toast-queue.ts` anywhere to use it. One at a time; a second toast queued while one
 * is showing waits its turn rather than stacking or interrupting. */
export function ToastHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const event = useToastQueue((s) => s.queue[0]);
  const shift = useToastQueue((s) => s.shift);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!event) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: motion.base, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: motion.base, useNativeDriver: true }).start(
        () => shift(),
      );
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [event, opacity, shift]);

  if (!event) return null;
  const bg = { default: colors.text, success: colors.success, danger: colors.danger }[event.tone];
  const fg = event.tone === 'default' ? colors.background : colors.onPrimary;

  return (
    <Animated.View
      testID="toast"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      pointerEvents="none"
      style={[
        styles.toast,
        { backgroundColor: bg, bottom: insets.bottom + spacing.lg, opacity },
      ]}
    >
      <Text style={{ color: fg }}>{event.message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...elevatedShadow,
  },
});
