import { Image, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { leagueColors } from '../theme/tokens';
import { Text } from './Text';

interface AvatarProps {
  name: string | null;
  photoUrl?: string | null;
  size?: number;
  testID?: string;
}

/** A small, fixed set of the existing league badge colors, reused as a deterministic per-name
 * palette so the same person always gets the same initials color — not a random bright color
 * picker, which would sit outside the app's palette. */
const INITIAL_TONES = ['WOOD', 'COPPER', 'SILVER', 'DIAMOND', 'PREFERRED', 'PATRON'] as const;

function initialsOf(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

function toneFor(name: string | null): (typeof INITIAL_TONES)[number] {
  if (!name) return INITIAL_TONES[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return INITIAL_TONES[hash % INITIAL_TONES.length]!;
}

/** A person's photo if they have one, otherwise their initials on a deterministic tint. Used for
 * the counterpart in a job, a review author, and anywhere else a face-sized identity marker is
 * needed. */
export function Avatar({ name, photoUrl, size = 40, testID }: AvatarProps) {
  const { colors } = useTheme();
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl) {
    return (
      <Image
        testID={testID}
        source={{ uri: photoUrl }}
        accessibilityLabel={name ?? undefined}
        style={[styles.image, dimension, { backgroundColor: colors.surfaceAlt }]}
      />
    );
  }
  const c = leagueColors[toneFor(name)]!;
  return (
    <View
      testID={testID}
      accessibilityLabel={name ?? undefined}
      style={[styles.initials, dimension, { backgroundColor: c.bg }]}
    >
      <Text
        variant="label"
        style={{ color: c.on, fontSize: Math.max(12, Math.round(size * 0.38)) }}
      >
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {},
  initials: { alignItems: 'center', justifyContent: 'center' },
});
