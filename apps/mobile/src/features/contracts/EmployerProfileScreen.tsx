import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { getEmployerProfile, updateEmployerProfile, useEmployerProfile } from '../../api/contracts';
import { Button, Card, Screen, Text, TextField } from '../../components';
import { errorMessage } from '../../lib/errors';
import { spacing } from '../../theme/tokens';

/** Set/update the business name (D-056: the whole employer "identity" this phase). Required once
 * before posting a listing (EMPLOYER_PROFILE_REQUIRED). */
export function EmployerProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const profile = useEmployerProfile(true);
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile.data) setBusinessName(profile.data.businessName);
  }, [profile.data]);

  async function save() {
    setError(undefined);
    setBusy(true);
    try {
      await updateEmployerProfile({ businessName });
      await qc.invalidateQueries({ queryKey: ['employer', 'profile'] });
      router.push('/employer/listings');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Text color="textMuted">{t('employer.profileIntro')}</Text>
      <Card>
        <View style={{ gap: spacing.md }}>
          <TextField
            testID="employer-business-name"
            label={t('employer.businessName')}
            value={businessName}
            onChangeText={setBusinessName}
            maxLength={120}
          />
          {error ? (
            <Text color="danger" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button
            testID="employer-save-profile"
            title={t('common.save')}
            onPress={() => void save()}
            loading={busy}
            disabled={businessName.trim().length < 2}
          />
        </View>
      </Card>
    </Screen>
  );
}

/** Best-effort check used by AccountScreen to decide which button to show, without needing a
 * dedicated "am I an employer yet" endpoint. */
export async function hasEmployerProfile(): Promise<boolean> {
  try {
    await getEmployerProfile();
    return true;
  } catch {
    return false;
  }
}
