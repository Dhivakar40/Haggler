import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { sendOtp, verifyOtp } from '../../api/endpoints';
import { Button, Checkbox, Screen, Text } from '../../components';
import { getDeviceId } from '../../auth/secure-storage';
import { devicePlatform, useSession } from '../../auth/session';
import { errorMessage } from '../../lib/errors';
import { formatIndianPhone } from '../../lib/phone';
import { useTheme } from '../../theme/ThemeProvider';
import { MIN_TOUCH_TARGET, radii, spacing } from '../../theme/tokens';

const RESEND_SECONDS = 30;
const CODE_LENGTH = 6;

/** Looks like 6 boxes; is really one accessible text input (testID stays `otp-input`) with a
 * transparent overlay catching touches/keystrokes, so paste, autofill (sms-otp) and screen readers
 * all keep working exactly as before — the boxes are a pure visual mirror of one piece of state. */
function OtpBoxes({
  value,
  onChangeText,
  label,
  error,
  testID,
}: {
  value: string;
  onChangeText: (v: string) => void;
  label: string;
  error?: string;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const activeIndex = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <View style={styles.otpWrap}>
      <View style={styles.otpHeader}>
        <Text variant="label">{label}</Text>
        <Text variant="caption" color="textMuted">
          {t('auth.otpDigitsHint', { count: CODE_LENGTH })}
        </Text>
      </View>
      <View style={styles.otpRow}>
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const active = i === activeIndex;
          return (
            <View
              key={i}
              style={[
                styles.otpBox,
                {
                  backgroundColor: colors.surface,
                  borderColor: error ? colors.danger : active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text variant="heading">{value[i] ?? ''}</Text>
            </View>
          );
        })}
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={value}
          onChangeText={(v) => onChangeText(v.replace(/\D/g, '').slice(0, CODE_LENGTH))}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={CODE_LENGTH}
          style={styles.otpInput}
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

export function OtpScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const { phone = '', email } = useLocalSearchParams<{ phone: string; email?: string }>();
  const startSession = useSession((s) => s.startSession);
  const [code, setCode] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  // Resend countdown. The server enforces the same 30 s, this just avoids a pointless request.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function verify() {
    if (!/^[0-9]{6}$/.test(code)) return setError(t('auth.otpInvalid'));
    setError(undefined);
    setBusy(true);
    try {
      const session = await verifyOtp({
        phone,
        code,
        deviceId: await getDeviceId(),
        platform: devicePlatform(),
        rememberMe,
      });
      await startSession(session);
      // The root layout now sees a signed-in user and shows the consent or the app.
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(undefined);
    try {
      await sendOtp(phone, email);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Pressable
          testID="back-button"
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: colors.surfaceAlt }]}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <View style={[styles.mark, { backgroundColor: colors.primary }]}>
          <Ionicons name="shield-checkmark-outline" size={28} color={colors.onPrimary} />
        </View>
        <Text variant="title">{t('app.name')}</Text>
        <Text color="textMuted">{t('auth.tagline')}</Text>
      </View>

      <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <Text variant="title">{t('auth.otpTitle')}</Text>
        <Text color="textMuted">{t('auth.otpSentTo')}</Text>
        <Text variant="heading" color="primary">
          {email ? email : formatIndianPhone(phone)}
        </Text>

        <OtpBoxes
          testID="otp-input"
          label={t('auth.otpLabel')}
          value={code}
          onChangeText={setCode}
          error={error}
        />

        <View style={styles.rememberWrap}>
          <Checkbox
            testID="remember-me"
            label={t('auth.rememberMe')}
            checked={rememberMe}
            onPress={() => setRememberMe((v) => !v)}
          />
          <Text variant="caption" color="textMuted" style={styles.rememberHint}>
            {t('auth.rememberMeHint')}
          </Text>
        </View>

        <Button
          testID="verify"
          title={t('auth.verify')}
          icon="arrow-forward"
          iconPosition="trailing"
          onPress={() => void verify()}
          loading={busy}
        />
        <Button
          testID="resend"
          variant="soft"
          icon="time-outline"
          title={cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}
          disabled={cooldown > 0}
          onPress={() => void resend()}
        />
        <Button
          variant="soft"
          icon="arrow-undo-outline"
          title={t('auth.changeNumber')}
          onPress={() => router.back()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.sm },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
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
  otpWrap: { gap: spacing.sm },
  otpHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  otpRow: { flexDirection: 'row', gap: spacing.sm, position: 'relative' },
  otpBox: {
    flex: 1,
    aspectRatio: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1.5,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
  },
  rememberWrap: { gap: spacing.xs },
  rememberHint: { marginLeft: 34 },
});
