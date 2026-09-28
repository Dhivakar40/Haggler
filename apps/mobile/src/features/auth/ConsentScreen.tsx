import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { LEGAL_VERSION } from '@haggler/shared';
import { grantConsent } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Button, Card, Chip, Screen, Text } from '../../components';
import { errorMessage } from '../../lib/errors';
import { spacing } from '../../theme/tokens';
import { PlaceholderBanner } from '../legal/LegalScreens';

/** DPDP: explicit, separate consent for the Terms and the Privacy Policy before using the app. */
export function ConsentScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const refreshMe = useSession((s) => s.refreshMe);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function agree() {
    if (!terms || !privacy) return setError(t('consent.mustAgree'));
    setError(undefined);
    setBusy(true);
    try {
      await grantConsent({ purpose: 'TERMS_OF_SERVICE', version: LEGAL_VERSION });
      await grantConsent({ purpose: 'PRIVACY_POLICY', version: LEGAL_VERSION });
      await refreshMe(); // missingConsents is now empty, so the root layout opens the app
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Text variant="title">{t('consent.title')}</Text>
      <Text color="textMuted">{t('consent.intro')}</Text>
      <PlaceholderBanner />
      <Card>
        <View style={{ gap: spacing.md }}>
          <Chip
            testID="consent-terms"
            label={t('consent.terms')}
            selected={terms}
            onPress={() => setTerms(!terms)}
          />
          <Button
            variant="secondary"
            title={t('consent.read')}
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })}
          />
          <Chip
            testID="consent-privacy"
            label={t('consent.privacy')}
            selected={privacy}
            onPress={() => setPrivacy(!privacy)}
          />
          <Button
            variant="secondary"
            title={t('consent.read')}
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
          />
        </View>
      </Card>
      {error ? (
        <Text color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        testID="consent-agree"
        title={t('consent.agree')}
        onPress={() => void agree()}
        loading={busy}
      />
    </Screen>
  );
}
