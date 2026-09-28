import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { sendOtp } from '../../api/endpoints';
import { Button, Screen, Text, TextField } from '../../components';
import { errorMessage } from '../../lib/errors';
import { normalizeIndianPhone } from '../../lib/phone';
import { spacing } from '../../theme/tokens';

export function PhoneScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    const phone = normalizeIndianPhone(raw);
    if (!phone) return setError(t('auth.phoneInvalid'));
    setError(undefined);
    setBusy(true);
    try {
      await sendOtp(phone);
      router.push({ pathname: '/otp', params: { phone } });
    } catch (err) {
      setError(errorMessage(err, t));
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
          error={error}
        />
        <Button
          testID="send-code"
          title={t('auth.sendCode')}
          onPress={() => void submit()}
          loading={busy}
        />
      </View>
    </Screen>
  );
}
