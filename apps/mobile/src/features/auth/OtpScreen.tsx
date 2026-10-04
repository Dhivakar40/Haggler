import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { sendOtp, verifyOtp } from '../../api/endpoints';
import { Button, Checkbox, Screen, Text, TextField } from '../../components';
import { getDeviceId } from '../../auth/secure-storage';
import { devicePlatform, useSession } from '../../auth/session';
import { errorMessage } from '../../lib/errors';
import { formatIndianPhone } from '../../lib/phone';
import { spacing } from '../../theme/tokens';

const RESEND_SECONDS = 30;

export function OtpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { phone = '' } = useLocalSearchParams<{ phone: string }>();
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
      await sendOtp(phone);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  return (
    <Screen scroll>
      <View style={{ gap: spacing.md, marginTop: spacing.xl }}>
        <Text variant="title">{t('auth.otpTitle')}</Text>
        <Text color="textMuted">{t('auth.otpSentTo', { phone: formatIndianPhone(phone) })}</Text>
        <TextField
          testID="otp-input"
          label={t('auth.otpLabel')}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={6}
          error={error}
        />
        <Checkbox
          testID="remember-me"
          label={t('auth.rememberMe')}
          checked={rememberMe}
          onPress={() => setRememberMe((v) => !v)}
        />
        <Button
          testID="verify"
          title={t('auth.verify')}
          onPress={() => void verify()}
          loading={busy}
        />
        <Button
          testID="resend"
          variant="secondary"
          title={cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}
          disabled={cooldown > 0}
          onPress={() => void resend()}
        />
        <Button variant="secondary" title={t('auth.changeNumber')} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
