import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@haggler/shared';
import { updateProfile } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Button, Chip, Screen, Text, TextField } from '../../components';
import { LANGUAGE_NATIVE_NAMES } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { spacing } from '../../theme/tokens';

export function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const refreshMe = useSession((s) => s.refreshMe);
  const [name, setName] = useState(user?.fullName ?? '');
  const [langs, setLangs] = useState<string[]>(user?.languages ?? ['en']);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const toggle = (l: SupportedLanguage) =>
    setLangs((cur) =>
      cur.includes(l) ? (cur.length > 1 ? cur.filter((x) => x !== l) : cur) : [...cur, l],
    );

  async function save() {
    if (name.trim().length < 2) return setError(t('common.error'));
    setError(undefined);
    setBusy(true);
    try {
      await updateProfile({ fullName: name.trim(), languages: langs as SupportedLanguage[] });
      await refreshMe();
      router.back();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <TextField
        testID="name-input"
        label={t('profile.name')}
        value={name}
        onChangeText={setName}
        autoComplete="name"
        maxLength={80}
        error={error}
      />
      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('profile.languages')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {SUPPORTED_LANGUAGES.map((l) => (
            <Chip
              key={l}
              testID={`spoken-${l}`}
              label={LANGUAGE_NATIVE_NAMES[l]}
              selected={langs.includes(l)}
              onPress={() => toggle(l)}
            />
          ))}
        </View>
      </View>
      <Button
        testID="save-profile"
        title={t('profile.save')}
        onPress={() => void save()}
        loading={busy}
      />
    </Screen>
  );
}
