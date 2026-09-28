import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '@haggler/shared';
import { useServerStatus } from '../../api/hooks';
import { Card, Chip, Screen, Text } from '../../components';
import { LANGUAGE_NATIVE_NAMES } from '../../i18n';
import { type ThemeMode, useSettings } from '../../store/settings';
import { spacing } from '../../theme/tokens';

const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

export function SettingsScreen() {
  const { t } = useTranslation();
  const { themeMode, language, setThemeMode, setLanguage } = useSettings();
  const status = useServerStatus();

  return (
    <Screen scroll>
      <Text variant="title">{t('settings.title')}</Text>

      <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('settings.appearance')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {THEME_MODES.map((mode) => (
            <Chip
              key={mode}
              testID={`theme-${mode}`}
              label={t(`settings.theme.${mode}`)}
              selected={themeMode === mode}
              onPress={() => setThemeMode(mode)}
            />
          ))}
        </View>
      </View>

      <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('settings.language')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip
            testID="lang-device"
            label={t('settings.languageDevice')}
            selected={language === null}
            onPress={() => setLanguage(null)}
          />
          {SUPPORTED_LANGUAGES.map((code) => (
            <Chip
              key={code}
              testID={`lang-${code}`}
              label={LANGUAGE_NATIVE_NAMES[code]}
              selected={language === code}
              onPress={() => setLanguage(code)}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('settings.environment')}</Text>
        <Card>
          {status.isLoading && <Text color="textMuted">{t('states.loading')}</Text>}
          {status.isError && <Text color="danger">{t('settings.apiDown')}</Text>}
          {status.data && (
            <View style={{ gap: spacing.xs }} testID="server-status">
              <Text color={status.data.status === 'ok' ? 'success' : 'warning'}>
                {status.data.status === 'ok' ? t('settings.apiOk') : t('settings.apiDegraded')}
              </Text>
              {Object.entries(status.data.adapters).map(([name, mode]) => (
                <Text key={name} variant="caption" color="textMuted">
                  {t(`settings.adapters.${name}`)}:{' '}
                  {mode === 'sandbox' ? t('settings.adapterSandbox') : t('settings.adapterLive')}
                </Text>
              ))}
            </View>
          )}
        </Card>
      </View>
    </Screen>
  );
}
