import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { LEGAL_VERSION } from '@haggler/shared';
import { grantConsent } from '../../api/endpoints';
import { useSession } from '../../auth/session';
import { Button, Card, Checkbox, Screen, Text } from '../../components';
import { errorMessage } from '../../lib/errors';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';
import { PlaceholderBanner } from '../legal/LegalScreens';

/** A card-style info row (tappable when `onPress` is set). Not promoted to `components/` yet —
 * see docs/ui-redesign/FOUNDATION.md ("one visual use so far"). */
function InfoRow({
  icon,
  title,
  subtitle,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress?: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Card testID={testID} onPress={onPress} accessibilityLabel={title} style={styles.infoCard}>
      <View style={styles.infoRow}>
        <View style={[styles.infoIcon, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
        <View style={styles.infoText}>
          <Text variant="label">{title}</Text>
          <Text variant="caption" color="textMuted">
            {subtitle}
          </Text>
        </View>
        {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
      </View>
    </Card>
  );
}

/** DPDP: explicit, separate consent for the Terms and the Privacy Policy before using the app. */
export function ConsentScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const refreshMe = useSession((s) => s.refreshMe);
  const signOut = useSession((s) => s.signOut);
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
      <View style={styles.hero}>
        <View style={[styles.mark, { backgroundColor: colors.primary }]}>
          <Ionicons name="construct-outline" size={28} color={colors.onPrimary} />
        </View>
        <Text variant="title">{t('app.name')}</Text>
        <Text color="textMuted">{t('auth.tagline')}</Text>
      </View>

      <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <Text variant="title">{t('consent.title')}</Text>
        <Text color="textMuted">{t('consent.intro')}</Text>
        <PlaceholderBanner />

        <View style={styles.infoList}>
          <InfoRow
            testID="consent-terms-info"
            icon="document-text-outline"
            title={t('legal.terms')}
            subtitle={t('consent.termsHint')}
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })}
          />
          <InfoRow
            testID="consent-privacy-info"
            icon="lock-closed-outline"
            title={t('legal.privacy')}
            subtitle={t('consent.privacyHint')}
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
          />
          <InfoRow
            icon="location-outline"
            title={t('consent.locationTitle')}
            subtitle={t('consent.locationHint')}
          />
          <InfoRow
            icon="notifications-outline"
            title={t('consent.notificationsTitle')}
            subtitle={t('consent.notificationsHint')}
          />
        </View>

        <View style={{ gap: spacing.md }}>
          <Checkbox
            testID="consent-terms"
            label={t('consent.terms')}
            checked={terms}
            onPress={() => setTerms(!terms)}
          />
          <Checkbox
            testID="consent-privacy"
            label={t('consent.privacy')}
            checked={privacy}
            onPress={() => setPrivacy(!privacy)}
          />
        </View>

        {error ? (
          <Text color="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button
          testID="consent-agree"
          title={t('consent.agree')}
          icon="arrow-forward"
          iconPosition="trailing"
          onPress={() => void agree()}
          loading={busy}
        />
        <Button
          testID="consent-sign-out"
          variant="soft"
          title={t('consent.signOutInstead')}
          onPress={() => void signOut()}
          disabled={busy}
        />
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
  sheet: {
    gap: spacing.md,
    padding: spacing.lg,
    marginHorizontal: -spacing.lg,
    borderRadius: radii.lg,
  },
  infoList: { gap: spacing.sm },
  infoCard: { padding: spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: { flex: 1, gap: 2 },
});
