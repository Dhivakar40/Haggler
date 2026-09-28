import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { type ColorTokens, type TextVariant, typography } from '../theme/tokens';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: keyof ColorTokens;
}

/** Headings get the "header" role so screen readers can jump between sections. */
export function Text({
  variant = 'body',
  color = 'text',
  style,
  accessibilityRole,
  ...rest
}: TextProps) {
  const { colors } = useTheme();
  const role =
    accessibilityRole ?? (variant === 'title' || variant === 'heading' ? 'header' : undefined);
  return (
    <RNText
      accessibilityRole={role}
      // Respect the user's font-size setting, but cap it so layouts don't break.
      maxFontSizeMultiplier={1.6}
      style={[typography[variant], { color: colors[color] }, style]}
      {...rest}
    />
  );
}
