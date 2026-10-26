import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { sendOtp } from '../../api/endpoints';
import { Button, Screen, Text, TextField } from '../../components';
import { errorMessage } from '../../lib/errors';
import { isValidEmail } from '../../lib/email';
import { normalizeIndianPhone } from '../../lib/phone';
import { spacing } from '../../theme/tokens';

export function PhoneScreen() {
  const { t } = useTranslation();
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
      <View style={{ gap: spacing.xs, marginTop: spacing.xl }}>
        <Text variant="title">{t('app.name')}</Text>
        <Text color="textMuted">{t('auth.tagline')}</Text>
      </View>
      <View style={{ gap: spacing.md }}>
        <Text variant="heading">{t('auth.phoneTitle')}</Text>
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
          onPress={() => void submit()}
          loading={busy}
        />
        <Button
          testID="toggle-email"
          variant="secondary"
          title={useEmail ? t('auth.useSmsInstead') : t('auth.emailInstead')}
          onPress={() => {
            setPhoneError(undefined);
            setEmailError(undefined);
            setUseEmail((v) => !v);
          }}
        />
      </View>
    </Screen>
  );
}
