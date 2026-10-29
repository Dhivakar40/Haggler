import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { sendOtp } from '../../api/endpoints';
import { Button, Screen, Text, TextField } from '../../components';
import { errorMessage } from '../../lib/errors';
import { isValidEmail } from '../../lib/email';
import { normalizeIndianPhone } from '../../lib/phone';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; key: string }[] = [
  { icon: 'shield-checkmark-outline', key: 'auth.featureVerified' },
  { icon: 'cash-outline', key: 'auth.featurePricing' },
  { icon: 'location-outline', key: 'auth.featureLocal' },
];

export function PhoneScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const [raw, setRaw] = useState('');
  const [useEmail, setUseEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [phoneError, setPhoneError] = useState<string>();
  const [emailError, setEmailError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    setPhoneError(undefined);
    setEmailError(undefined);
    const phone = normalizeIndianPhone(raw);
    const trimmedEmail = email.trim();
    let hasError = false;
    // The phone number is still the account's identity even when the code goes out by email —
    // it's a delivery-channel choice, not a different way to sign in — so it's always required.
    if (!phone) {
      setPhoneError(t('auth.phoneInvalid'));
      hasError = true;
    }
    if (useEmail && !isValidEmail(trimmedEmail)) {
      setEmailError(t('auth.emailInvalid'));
      hasError = true;
    }
    if (hasError || !phone) return;
    setBusy(true);
    try {
      await sendOtp(phone, useEmail ? trimmedEmail : undefined);
      router.push({
        pathname: '/otp',
        params: useEmail ? { phone, email: trimmedEmail } : { phone },
      });
    } catch (err) {
      setPhoneError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <View style={[styles.mark, { backgroundColor: colors.primary }]}>
          <Ionicons name="construct-outline" size={28} color={colors.onPrimary} />
        </View>
        <Text variant="title">{t('app.name')}</Text>
        <Text color="textMuted">{t('auth.tagline')}</Text>
        <View style={styles.features}>
          {FEATURES.map(({ icon, key }) => (
            <View key={key} style={styles.featureRow}>
              <View style={[styles.featureIcon, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name={icon} size={16} color={colors.primary} />
              </View>
              <Text>{t(key)}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <Text variant="title">{t('auth.phoneTitle')}</Text>
        <Text color="textMuted">{t('auth.phoneHint')}</Text>
        <TextField
          testID="phone-input"
          label={t('auth.phoneLabel')}
          prefix="+91"
          value={raw}
          onChangeText={setRaw}
          keyboardType="phone-pad"
          autoComplete="tel"
          maxLength={16}
          error={phoneError}
        />
        {useEmail ? (
          <>
            <Text color="textMuted">{t('auth.emailStillNeedsPhone')}</Text>
            <TextField
              testID="email-input"
              label={t('auth.emailLabel')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              autoCapitalize="none"
              error={emailError}
            />
          </>
        ) : null}
        <Button
          testID="send-code"
          title={t('auth.sendCode')}
          icon="arrow-forward"
          iconPosition="trailing"
          onPress={() => void submit()}
          loading={busy}
        />

        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text color="textMuted" variant="caption">
            {t('auth.or')}
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        <Button
          testID="toggle-email"
          variant="soft"
          icon="mail-outline"
          title={useEmail ? t('auth.useSmsInstead') : t('auth.emailInstead')}
          onPress={() => {
            setPhoneError(undefined);
            setEmailError(undefined);
            setUseEmail((v) => !v);
          }}
        />

        <Text color="textMuted" variant="caption" style={styles.disclaimer}>
          {t('auth.disclaimer', { terms: t('legal.terms'), privacy: t('legal.privacy') })}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.sm },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radii.lg,
    marginBottom: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  features: { gap: spacing.sm, marginTop: spacing.sm },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  featureIcon: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    gap: spacing.md,
    padding: spacing.lg,
    marginHorizontal: -spacing.lg,
    borderRadius: radii.lg,
  },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dividerLine: { flex: 1, height: 1 },
  disclaimer: { textAlign: 'center' },
});
