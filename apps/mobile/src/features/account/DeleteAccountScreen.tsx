import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requestDeletion } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Button, Screen, Text } from '../../components';
import { errorMessage } from '../../lib/errors';

export function DeleteAccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const refreshMe = useSession((s) => s.refreshMe);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(undefined);
    try {
      await requestDeletion();
      // D-108: the account stays usable for the 48-hour grace period, so there's nothing to sign
      // out of — just pick up the new deletionScheduledFor so the top banner appears.
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
      <Text variant="title">{t('deleteAccount.title')}</Text>
      <Text>{t('deleteAccount.warning')}</Text>
      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        testID="confirm-delete"
        variant="danger"
        title={t('deleteAccount.confirm')}
        onPress={() => void confirm()}
        loading={busy}
      />
      <Button variant="secondary" title={t('deleteAccount.keep')} onPress={() => router.back()} />
    </Screen>
  );
}
