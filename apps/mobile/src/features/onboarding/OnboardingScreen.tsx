import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { Gender } from '@haggler/shared';
import { completeOnboarding } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Button, Card, Screen, Text, TextField } from '../../components';
import { PersonalDetailsFields } from '../account/PersonalDetailsFields';
import { errorMessage } from '../../lib/errors';
import { type DobParts, partsToDob } from '../../lib/dob';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

const STEPS = ['stepProfile', 'stepAddress', 'stepPreferences'] as const;

/** A progress indicator only — steps 2/3 don't exist as screens yet (see
 * docs/ui-redesign/PAGES.md), so the circles are never tappable. */
function Stepper({ active }: { active: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={styles.stepperRow}>
      {STEPS.map((key, i) => (
        <View key={key} style={styles.stepperItem}>
          {i > 0 ? (
            <View
              style={[
                styles.stepperLine,
                { backgroundColor: i <= active ? colors.primary : colors.border },
              ]}
            />
          ) : null}
          <View style={styles.stepperStep}>
            <View
              style={[
                styles.stepperDot,
                {
                  backgroundColor: i === active ? colors.primary : colors.surfaceAlt,
                  borderColor: i === active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                variant="label"
                style={{ color: i === active ? colors.onPrimary : colors.textMuted }}
              >
                {i + 1}
              </Text>
            </View>
            <Text
              variant="caption"
              color={i === active ? 'text' : 'textMuted'}
              style={styles.stepperLabel}
            >
              {t(`onboarding.${key}`)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The mandatory first-sign-in setup (Part B, D-075): shown once, before the main app is usable,
 * right after sign-in/consent. `_layout.tsx`'s Navigator gates every other route behind
 * `user.profileComplete`, so there is no way to skip or dismiss this short of filling it in.
 * Email stays optional (D-111) — a person can add it later from Settings > Edit Profile, same as
 * every other optional field here.
 */
export function OnboardingScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const refreshMe = useSession((s) => s.refreshMe);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState<DobParts>({ day: '', month: '', year: '' });
  const [gender, setGender] = useState<Gender | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    const dateOfBirth = partsToDob(dob);
    const trimmedEmail = email.trim();
    if (name.trim().length < 2) return setError(t('onboarding.nameInvalid'));
    if (!dateOfBirth) return setError(t('onboarding.dobInvalid'));
    if (!gender) return setError(t('onboarding.genderInvalid'));
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail))
      return setError(t('onboarding.emailInvalid'));

    setError(undefined);
    setBusy(true);
    try {
      await completeOnboarding({
        fullName: name.trim(),
        dateOfBirth,
        gender,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
      });
      await refreshMe();
      // The root layout now sees profileComplete and shows the app.
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stepper active={0} />

      <View style={styles.hero}>
        <View style={[styles.mark, { backgroundColor: colors.primary }]}>
          <Ionicons name="person-outline" size={28} color={colors.onPrimary} />
        </View>
        <Text variant="title">{t('onboarding.title')}</Text>
        <Text color="textMuted">{t('onboarding.intro')}</Text>
      </View>

      <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <TextField
          testID="onboarding-name"
          label={t('onboarding.nameLabel')}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          maxLength={80}
        />
        <TextField
          testID="email-input"
          label={t('onboarding.emailLabel')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          maxLength={254}
        />

        <View style={styles.photoSection}>
          <Text variant="label">{t('onboarding.photoLabel')}</Text>
          <View style={styles.photoRow}>
            <View style={[styles.photoBox, { borderColor: colors.border }]}>
              <Ionicons name="camera-outline" size={22} color={colors.textMuted} />
              <Text variant="caption" color="textMuted">
                {t('onboarding.photoAdd')}
              </Text>
            </View>
            <Card style={styles.photoHintCard}>
              <Text variant="caption" color="textMuted">
                {t('onboarding.photoHint')}
              </Text>
            </Card>
          </View>
        </View>

        <PersonalDetailsFields
          email={email}
          onEmailChange={setEmail}
          dob={dob}
          onDobChange={setDob}
          gender={gender}
          onGenderChange={setGender}
          hideEmail
        />
        {error ? (
          <Text color="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button
          testID="onboarding-continue"
          title={t('onboarding.continue')}
          icon="arrow-forward"
          iconPosition="trailing"
          onPress={() => void submit()}
          loading={busy}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepperRow: { flexDirection: 'row' },
  stepperItem: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  stepperLine: { flex: 1, height: 2, marginBottom: 20 },
  stepperStep: { alignItems: 'center', gap: spacing.xs },
  stepperDot: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperLabel: { maxWidth: 72, textAlign: 'center' },
  hero: { gap: spacing.sm },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radii.lg,
    marginBottom: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    gap: spacing.md,
    padding: spacing.lg,
    marginHorizontal: -spacing.lg,
    borderRadius: radii.lg,
  },
  photoSection: { gap: spacing.sm },
  photoRow: { flexDirection: 'row', gap: spacing.sm },
  photoBox: {
    width: 110,
    height: 100,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  photoHintCard: { flex: 1, justifyContent: 'center' },
});
