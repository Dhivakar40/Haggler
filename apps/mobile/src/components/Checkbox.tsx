import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH_TARGET, radii, spacing } from '../theme/tokens';
import { Text } from './Text';

interface CheckboxProps {
  label: string;
  checked: boolean;
  onPress: () => void;
  testID?: string;
}

/** A single on/off choice (unlike Chip, which is a radio option within a group). */
export function Checkbox({ label, checked, onPress, testID }: CheckboxProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={styles.row}
    >
      <View
        style={[
          styles.box,
          {
            backgroundColor: checked ? colors.primary : colors.surface,
            borderColor: checked ? colors.primary : colors.border,
          },
        ]}
      >
        {checked ? <View style={[styles.mark, { backgroundColor: colors.onPrimary }]} /> : null}
      </View>
      <Text>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { width: 10, height: 10, borderRadius: 2 },
});
