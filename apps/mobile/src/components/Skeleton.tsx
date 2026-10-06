import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, type DimensionValue, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { motion, radii } from '../theme/tokens';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  testID?: string;
}

/** A loading placeholder block. Screens compose several of these into a skeleton that roughly
 * matches the real layout (see each screen's LoadingState usage) rather than a single generic
 * spinner, so the page doesn't visibly jump once data arrives. Pulses opacity, not position/size —
 * cheap on low-end devices and automatically skipped when the OS "reduce motion" setting is on. */
export function Skeleton({ width = '100%', height = 16, radius = radii.sm, testID }: SkeletonProps) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: motion.slow, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.5, duration: motion.slow, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.block,
        { width, height, borderRadius: radius, backgroundColor: colors.surfaceAlt, opacity },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  block: {},
});
