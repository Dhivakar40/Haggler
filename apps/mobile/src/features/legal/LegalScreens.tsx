import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card, Screen, Text } from '../../components';
import { spacing } from '../../theme/tokens';

export const LEGAL_DOCS = ['terms', 'privacy', 'refund', 'grievance'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

/** Clearly marked placeholder: the real text must come from counsel (docs/COMPLIANCE.md). */
export function PlaceholderBanner() {
  const { t } = useTranslation();
  return (
    <Card style={{ borderColor: '#B45309' }}>
      <Text variant="label" color="warning" accessibilityRole="alert">
        {t('legal.banner')}
      </Text>
    </Card>
  );
}

export function LegalListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen scroll>
      <PlaceholderBanner />
      <View style={{ gap: spacing.md }}>
        {LEGAL_DOCS.map((doc) => (
          <Card
            key={doc}
            testID={`legal-${doc}`}
            accessibilityLabel={t(`legal.${doc}`)}
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc } })}
          >
            <Text variant="heading">{t(`legal.${doc}`)}</Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

export function LegalDocScreen() {
  const { t } = useTranslation();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const known = (LEGAL_DOCS as readonly string[]).includes(doc ?? '');
  if (doc === 'grievance') {
    return (
      <Screen scroll>
        <Text variant="title">{t('legal.grievance')}</Text>
        <Card>
          <View style={{ gap: spacing.xs }}>
            <Text color="textMuted">{t('legal.grievanceOfficer')}</Text>
            <Text variant="heading">{t('legal.grievanceName')}</Text>
            <Text>{t('legal.grievanceEmail')}</Text>
            <Text>{t('legal.grievancePhone')}</Text>
            <Text color="textMuted">{t('legal.grievanceHours')}</Text>
          </View>
        </Card>
        <Text color="warning" accessibilityRole="alert">
          {t('legal.grievancePlaceholder')}
        </Text>
      </Screen>
    );
  }
  return (
    <Screen scroll>
      <PlaceholderBanner />
      <Text variant="title">{known ? t(`legal.${doc}`) : t('legal.title')}</Text>
      <Text>{t('legal.body')}</Text>
    </Screen>
  );
}
