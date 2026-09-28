import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MIN_TOUCH_TARGET, radii, spacing } from '../theme/tokens';
import { Text } from './Text';

interface TextFieldProps extends Pick<
  TextInputProps,
  | 'value'
  | 'onChangeText'
  | 'keyboardType'
  | 'maxLength'
  | 'autoComplete'
  | 'autoCapitalize'
  | 'textContentType'
  | 'secureTextEntry'
  | 'multiline'
  | 'editable'
> {
  label: string;
  error?: string;
  prefix?: string;
  testID?: string;
}

/** Labelled input. The label is read by screen readers, and errors are announced as alerts. */
export function TextField({ label, error, prefix, testID, ...input }: TextFieldProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      <View
        style={[
          styles.box,
          { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border },
        ]}
      >
        {prefix ? <Text color="textMuted">{prefix}</Text> : null}
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.text }]}
          {...input}
        />
      </View>
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  box: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: spacing.sm },
});
