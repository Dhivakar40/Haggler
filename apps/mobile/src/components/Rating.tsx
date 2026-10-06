import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';

interface RatingProps {
  /** 0 (nothing chosen, or no rating yet) to 5. */
  value: number;
  /** Omit for a read-only display (a review's own stars); pass it to make the five stars
   * tappable (choosing a rating to submit). */
  onChange?: (n: number) => void;
  size?: number;
  testID?: string;
}

/** The app's one star-rating control — picking a rating (ReviewPrompt) and showing one already
 * given (RangerReviewsScreen) were two separate, near-identical implementations before Phase UI
 * (docs/UI_AUDIT.md §11.4). */
export function Rating({ value, onChange, size = 20, testID }: RatingProps) {
  const { colors } = useTheme();
  const interactive = !!onChange;
  return (
    <View
      testID={testID}
      accessibilityLabel={!interactive ? `${value} out of 5 stars` : undefined}
      style={{ flexDirection: 'row', gap: interactive ? spacing.sm : 2 }}
    >
      {[1, 2, 3, 4, 5].map((n) =>
        interactive ? (
          <Pressable
            key={n}
            testID={`star-${n}`}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
            hitSlop={8}
            onPress={() => onChange(n)}
          >
            <Ionicons
              name={n <= value ? 'star' : 'star-outline'}
              size={size}
              color={n <= value ? colors.warning : colors.textMuted}
            />
          </Pressable>
        ) : (
          <Ionicons
            key={n}
            name={n <= value ? 'star' : 'star-outline'}
            size={size}
            color={colors.warning}
          />
        ),
      )}
    </View>
  );
}
