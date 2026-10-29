import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { addressInputSchema, type AddressInput, type Gender } from '@haggler/shared';
import { useCategories } from '../../api/hooks';
import { ApiError } from '../../api/client';
import { completeOnboarding, createAddress } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Button, Card, Checkbox, Chip, Screen, Text, TextField } from '../../components';
import { ensureForegroundPermission } from '../../location/tracker';
import { PersonalDetailsFields } from '../account/PersonalDetailsFields';
import { useAddressLocation } from '../account/useAddressLocation';
import { errorMessage } from '../../lib/errors';
import { type DobParts, partsToDob } from '../../lib/dob';
import { syncPushRegistration } from '../../notifications/push';
import { useSettings } from '../../store/settings';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

const STEPS = ['stepProfile', 'stepAddress', 'stepPreferences'] as const;
const LABEL_PRESETS = ['Home', 'Work', 'Other'] as const;

/** A progress indicator only — the dots are never tappable (going back a step only works via the
 * header back button, which keeps that step's already-entered values). A filled dot (`i < active`)
 * shows a checkmark for a step already completed earlier in this session. */
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pendingAddress, setPendingAddress] = useState<AddressInput | null>(null);

  const categories = useCategories(step === 3);
  const pushNotificationsEnabled = useSettings((s) => s.pushNotificationsEnabled);
  const setPushNotificationsEnabled = useSettings((s) => s.setPushNotificationsEnabled);
  const locationEnabled = useSettings((s) => s.locationEnabled);
  const setLocationEnabled = useSettings((s) => s.setLocationEnabled);
  const preferredCategorySlugs = useSettings((s) => s.preferredCategorySlugs);
  const setPreferredCategorySlugs = useSettings((s) => s.setPreferredCategorySlugs);

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

  function skipAddress() {
    setPendingAddress(null);
    setStep(3);
  }

  function continueFromAddress() {
    const hasAnyInput = Object.values(addr).some((v) => v.trim());
    if (!hasAnyInput) return skipAddress();
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
    setAddressError(undefined);
    setPendingAddress(parsed.data);
    setStep(3);
  }

  function toggleCategory(slug: string) {
    setPreferredCategorySlugs(
      preferredCategorySlugs.includes(slug)
        ? preferredCategorySlugs.filter((s) => s !== slug)
        : [...preferredCategorySlugs, slug],
    );
  }

  async function togglePush() {
    const next = !pushNotificationsEnabled;
    setPushNotificationsEnabled(next);
    await syncPushRegistration(next);
  }

  async function toggleLocation() {
    const next = !locationEnabled;
    setLocationEnabled(next);
    if (next) await ensureForegroundPermission();
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

  if (step === 2) {
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
          onPress={skipAddress}
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
          onPress={skipAddress}
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

  return (
    <Screen scroll>
      <View style={styles.topRow}>
        <Pressable
          testID="onboarding-back"
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => setStep(2)}
          style={[styles.backButton, { backgroundColor: colors.surfaceAlt }]}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <Pressable
          testID="onboarding-skip-preferences"
          accessibilityRole="button"
          onPress={() => void finish(pendingAddress)}
          disabled={busy}
          style={[styles.skipButton, { backgroundColor: colors.surfaceAlt }]}
        >
          <Text variant="label">{t('onboarding.preferencesSkip')}</Text>
        </Pressable>
      </View>

      <Stepper active={2} />

      <View style={styles.hero}>
        <View style={[styles.mark, { backgroundColor: colors.primary }]}>
          <Ionicons name="settings-outline" size={28} color={colors.onPrimary} />
        </View>
        <Text variant="title">{t('onboarding.preferencesTitle')}</Text>
        <Text color="textMuted">{t('onboarding.preferencesIntro')}</Text>
      </View>

      <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <View style={styles.categoriesSection}>
          <Text variant="heading">{t('onboarding.categoriesHeading')}</Text>
          <Text color="textMuted">{t('onboarding.categoriesHint')}</Text>
          <View style={styles.categoriesGrid}>
            {(categories.data ?? []).map((cat) => {
              const selected = preferredCategorySlugs.includes(cat.slug);
              const iconName =
                cat.icon in Ionicons.glyphMap
                  ? (cat.icon as keyof typeof Ionicons.glyphMap)
                  : 'ellipsis-horizontal-circle-outline';
              return (
                <Card
                  key={cat.id}
                  testID={`preferred-category-${cat.slug}`}
                  accessibilityLabel={t(cat.nameKey)}
                  onPress={() => toggleCategory(cat.slug)}
                  style={{
                    ...styles.categoryTile,
                    ...(selected
                      ? { borderColor: colors.primary, backgroundColor: colors.surfaceAlt }
                      : null),
                  }}
                >
                  <View style={styles.categoryRow}>
                    <Ionicons name={iconName} size={20} color={colors.primary} />
                    <Text variant="label" style={styles.categoryLabel} numberOfLines={2}>
                      {t(cat.nameKey)}
                    </Text>
                  </View>
                  {selected ? (
                    <View style={[styles.categoryCheck, { backgroundColor: colors.primary }]}>
                      <Ionicons name="checkmark" size={12} color={colors.onPrimary} />
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        </View>

        <View style={styles.prefSection}>
          <Text variant="heading">{t('settings.notifications')}</Text>
          <Text color="textMuted">{t('onboarding.notificationsIntro')}</Text>
          <Card style={styles.prefCard}>
            <Checkbox
              testID="onboarding-push-toggle"
              label={t('settings.pushNotifications')}
              checked={pushNotificationsEnabled}
              onPress={() => void togglePush()}
            />
            <Text variant="caption" color="textMuted">
              {t('settings.pushNotificationsHint')}
            </Text>
          </Card>
        </View>

        <View style={styles.prefSection}>
          <Text variant="heading">{t('onboarding.locationHeading')}</Text>
          <Text color="textMuted">{t('onboarding.locationIntro')}</Text>
          <Card style={styles.prefCard}>
            <Checkbox
              testID="onboarding-location-toggle"
              label={t('onboarding.useLocationToggle')}
              checked={locationEnabled}
              onPress={() => void toggleLocation()}
            />
            <Text variant="caption" color="textMuted">
              {t('onboarding.useLocationHint')}
            </Text>
          </Card>
        </View>

        {addressError ? (
          <Text color="danger" accessibilityRole="alert">
            {addressError}
          </Text>
        ) : null}
        <Button
          testID="onboarding-finish"
          title={t('onboarding.finishSetup')}
          icon="arrow-forward"
          iconPosition="trailing"
          onPress={() => void finish(pendingAddress)}
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
  categoriesSection: { gap: spacing.xs },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  categoryTile: {
    width: '31%',
    padding: spacing.sm,
    borderRadius: radii.md,
    gap: spacing.xs,
  },
  categoryRow: { gap: spacing.xs },
  categoryLabel: { lineHeight: 16 },
  categoryCheck: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 16,
    height: 16,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefSection: { gap: spacing.xs },
  prefCard: { gap: spacing.sm, marginTop: spacing.sm },
});
