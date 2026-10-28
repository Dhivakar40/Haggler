import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '@haggler/shared';
import { registerPushToken, unregisterPushToken } from '../../api/endpoints';
import { getDeviceId } from '../../auth/secure-storage';
import { Button, Checkbox, Chip, Screen, Text } from '../../components';
import { LANGUAGE_NATIVE_NAMES } from '../../i18n';
import { registerForPushNotificationsAsync } from '../../notifications/push';
import { showToast } from '../../store/toast-queue';
import { type ThemeMode, useSettings } from '../../store/settings';
import { spacing } from '../../theme/tokens';

const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

export function SettingsScreen() {
  const { t } = useTranslation();
  const { themeMode, language, pushNotificationsEnabled, setThemeMode, setLanguage } =
    useSettings();
  const setPushNotificationsEnabled = useSettings((s) => s.setPushNotificationsEnabled);
  const qc = useQueryClient();
  const [clearing, setClearing] = useState(false);

  async function togglePush() {
    const next = !pushNotificationsEnabled;
    setPushNotificationsEnabled(next);
    const deviceId = await getDeviceId();
    if (next) {
      const token = await registerForPushNotificationsAsync();
      if (token) await registerPushToken({ deviceId, pushToken: token }).catch(() => undefined);
    } else {
      await unregisterPushToken({ deviceId }).catch(() => undefined);
    }
  }

  async function clearCache() {
    setClearing(true);
    try {
      qc.clear();
      showToast(t('settings.cacheCleared'), 'success');
    } finally {
      setClearing(false);
    }
  }

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
        <Text variant="heading">{t('settings.notifications')}</Text>
        <Checkbox
          testID="push-notifications-toggle"
          label={t('settings.pushNotifications')}
          checked={pushNotificationsEnabled}
          onPress={() => void togglePush()}
        />
        <Text variant="caption" color="textMuted">
          {t('settings.pushNotificationsHint')}
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="heading">{t('settings.storage')}</Text>
        <Text color="textMuted">{t('settings.clearCacheHint')}</Text>
        <Button
          testID="clear-cache"
          variant="secondary"
          title={t('settings.clearCache')}
          loading={clearing}
          onPress={() => void clearCache()}
        />
      </View>
    </Screen>
  );
}
