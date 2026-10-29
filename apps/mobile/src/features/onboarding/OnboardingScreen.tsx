import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { addressInputSchema, type AddressInput, type Gender } from '@haggler/shared';
import { ApiError } from '../../api/client';
import { completeOnboarding, createAddress } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Button, Card, Chip, Screen, Text, TextField } from '../../components';
import { PersonalDetailsFields } from '../account/PersonalDetailsFields';
import { useAddressLocation } from '../account/useAddressLocation';
import { errorMessage } from '../../lib/errors';
import { type DobParts, partsToDob } from '../../lib/dob';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

const STEPS = ['stepProfile', 'stepAddress', 'stepPreferences'] as const;
const LABEL_PRESETS = ['Home', 'Work', 'Other'] as const;

/** A progress indicator only — step 3 doesn't exist as a screen yet (see
 * docs/ui-redesign/PAGES.md), so the circles are never tappable; only going back to a step
 * already filled in on this device (`maxReached`) works, via the header back button. */
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
                  backgroundColor: i <= active ? colors.primary : colors.surfaceAlt,
                  borderColor: i <= active ? colors.primary : colors.border,
                },
              ]}
            >
              {i < active ? (
                <Ionicons name="checkmark" size={16} color={colors.onPrimary} />
              ) : (
                <Text
                  variant="label"
                  style={{ color: i === active ? colors.onPrimary : colors.textMuted }}
                >
                  {i + 1}
                </Text>
              )}
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
interface AddressFields {
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

const EMPTY_ADDRESS: AddressFields = { line1: '', line2: '', city: '', state: '', pincode: '' };

/**
 * Step 1 (Profile) fields are collected but NOT sent until step 2 finishes: `completeOnboarding`
 * is a one-time call (the server rejects a second one), and `_layout.tsx`'s Navigator switches
 * away from this whole route the instant `profileComplete` flips true — so there is no later
 * point at which a step 2 could still run. Address creation (optional) happens right alongside it.
 */
export function OnboardingScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const refreshMe = useSession((s) => s.refreshMe);
  const [step, setStep] = useState<1 | 2>(1);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState<DobParts>({ day: '', month: '', year: '' });
  const [gender, setGender] = useState<Gender | null>(null);
  const [profileError, setProfileError] = useState<string>();

  const [addr, setAddr] = useState<AddressFields>(EMPTY_ADDRESS);
  const [addressLabel, setAddressLabel] = useState<string>('Home');
  const [addressError, setAddressError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const setAddrField = (k: keyof AddressFields) => (v: string) =>
    setAddr((cur) => ({ ...cur, [k]: v }));
  const { coords, status: locationStatus, locating, useMyLocation } = useAddressLocation((place) =>
    setAddr((cur) => ({
      ...cur,
      city: cur.city || place.city || '',
      state: cur.state || place.region || '',
      pincode: cur.pincode || place.postalCode || '',
    })),
  );

  function continueFromProfile() {
    const dateOfBirth = partsToDob(dob);
    const trimmedEmail = email.trim();
    if (name.trim().length < 2) return setProfileError(t('onboarding.nameInvalid'));
    if (!dateOfBirth) return setProfileError(t('onboarding.dobInvalid'));
    if (!gender) return setProfileError(t('onboarding.genderInvalid'));
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail))
      return setProfileError(t('onboarding.emailInvalid'));
    setProfileError(undefined);
    setStep(2);
  }

  /** Shared by "Continue" (address saved) and "Skip"/"I'll add this later" (address discarded). */
  async function finish(address: AddressInput | null) {
    setAddressError(undefined);
    setBusy(true);
    try {
      const dateOfBirth = partsToDob(dob)!; // re-validated at the step 1 -> 2 transition
      const trimmedEmail = email.trim();
      try {
        await completeOnboarding({
          fullName: name.trim(),
          dateOfBirth,
          gender: gender!,
          ...(trimmedEmail ? { email: trimmedEmail } : {}),
        });
      } catch (err) {
        // A network drop between completeOnboarding succeeding and refreshMe() running below
        // would otherwise strand this screen: retrying would hit the one-time guard and look
        // like a failure. Already-done is success, not an error, for this screen's purposes.
        const alreadyDone = err instanceof ApiError && err.code === 'CONFLICT';
        if (!alreadyDone) throw err;
      }
      if (address) await createAddress(address);
      await refreshMe();
      // The root layout now sees profileComplete and shows the app.
    } catch (err) {
      setAddressError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  function continueFromAddress() {
    const hasAnyInput = Object.values(addr).some((v) => v.trim());
    if (!hasAnyInput) return void finish(null);
    const parsed = addressInputSchema.safeParse({
      label: addressLabel,
      line1: addr.line1,
      ...(addr.line2.trim() ? { line2: addr.line2 } : {}),
      city: addr.city,
      state: addr.state,
      pincode: addr.pincode.trim(),
      ...(coords ?? {}),
    });
    if (!parsed.success) return setAddressError(t('addresses.invalid'));
    void finish(parsed.data);
  }

  if (step === 1) {
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
          {profileError ? (
            <Text color="danger" accessibilityRole="alert">
              {profileError}
            </Text>
          ) : null}
          <Button
            testID="onboarding-continue"
            title={t('onboarding.continue')}
            icon="arrow-forward"
            iconPosition="trailing"
            onPress={continueFromProfile}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.topRow}>
        <Pressable
          testID="onboarding-back"
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => setStep(1)}
          style={[styles.backButton, { backgroundColor: colors.surfaceAlt }]}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <Pressable
          testID="onboarding-skip-address"
          accessibilityRole="button"
          onPress={() => void finish(null)}
          disabled={busy}
          style={[styles.skipButton, { backgroundColor: colors.surfaceAlt }]}
        >
          <Text variant="label">{t('onboarding.addressSkip')}</Text>
        </Pressable>
      </View>

      <Stepper active={1} />

      <View style={styles.hero}>
        <Text variant="title">{t('onboarding.addressTitle')}</Text>
        <Text color="textMuted">{t('onboarding.addressIntro')}</Text>
      </View>

      <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <Button
          testID="use-location"
          variant="soft"
          icon="location-outline"
          title={locating ? t('addresses.locating') : t('addresses.useLocation')}
          onPress={() => void useMyLocation()}
          disabled={locating}
        />
        {locationStatus ? (
          <Text color={coords ? 'success' : 'warning'}>{locationStatus}</Text>
        ) : null}

        <TextField
          testID="line1"
          label={t('addresses.line1')}
          value={addr.line1}
          onChangeText={setAddrField('line1')}
          maxLength={120}
        />
        <TextField
          testID="line2"
          label={t('addresses.line2')}
          value={addr.line2}
          onChangeText={setAddrField('line2')}
          maxLength={120}
        />
        <View style={styles.row}>
          <View style={styles.rowField}>
            <TextField
              testID="city"
              label={t('addresses.city')}
              value={addr.city}
              onChangeText={setAddrField('city')}
              maxLength={60}
            />
          </View>
          <View style={styles.rowField}>
            <TextField
              testID="pincode"
              label={t('addresses.pincode')}
              value={addr.pincode}
              onChangeText={setAddrField('pincode')}
              keyboardType="number-pad"
              maxLength={6}
            />
          </View>
        </View>
        <TextField
          testID="state"
          label={t('addresses.state')}
          value={addr.state}
          onChangeText={setAddrField('state')}
          maxLength={60}
        />

        <View style={styles.labelSection}>
          <Text variant="label">{t('onboarding.saveAddressAs')}</Text>
          <View style={styles.labelChips}>
            {LABEL_PRESETS.map((preset) => (
              <Chip
                key={preset}
                testID={`address-label-${preset}`}
                label={t(`addresses.preset${preset}`)}
                selected={addressLabel === preset}
                onPress={() => setAddressLabel(preset)}
              />
            ))}
          </View>
        </View>

        {addressError ? (
          <Text color="danger" accessibilityRole="alert">
            {addressError}
          </Text>
        ) : null}
        <Button
          testID="onboarding-continue-address"
          title={t('onboarding.continue')}
          icon="arrow-forward"
          iconPosition="trailing"
          onPress={continueFromAddress}
          loading={busy}
        />
        <Pressable
          testID="onboarding-skip-address-later"
          accessibilityRole="button"
          onPress={() => void finish(null)}
          disabled={busy}
          style={styles.skipLater}
        >
          <Text variant="label" color="textMuted">
            {t('onboarding.addressSkip')}
          </Text>
        </Pressable>
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
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  row: { flexDirection: 'row', gap: spacing.md },
  rowField: { flex: 1 },
  labelSection: { gap: spacing.sm },
  labelChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  skipLater: { alignItems: 'center', paddingVertical: spacing.sm },
});
