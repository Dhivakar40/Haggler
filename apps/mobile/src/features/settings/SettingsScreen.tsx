import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '@haggler/shared';
import { Button, Card, Checkbox, Chip, Screen, Text } from '../../components';
import { LANGUAGE_NATIVE_NAMES } from '../../i18n';
import { syncPushRegistration } from '../../notifications/push';
import { showToast } from '../../store/toast-queue';
import { type ThemeMode, useSettings } from '../../store/settings';
import { useTheme } from '../../theme/ThemeProvider';
import { radii, spacing } from '../../theme/tokens';

const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

function SectionHeading({ title, icon }: { title: string; icon: keyof typeof Ionicons.glyphMap }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeading}>
      <Ionicons name={icon} size={19} color={colors.primary} />
      <Text variant="heading">{title}</Text>
    </View>
  );
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { themeMode, language, pushNotificationsEnabled, setThemeMode, setLanguage } =
    useSettings();
  const setPushNotificationsEnabled = useSettings((s) => s.setPushNotificationsEnabled);
  const qc = useQueryClient();
  const [clearing, setClearing] = useState(false);

  async function togglePush() {
    const next = !pushNotificationsEnabled;
    setPushNotificationsEnabled(next);
    await syncPushRegistration(next);
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
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="settings-outline" size={26} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text variant="title">{t('settings.title')}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeading title={t('settings.appearance')} icon="color-palette-outline" />
        <Card style={styles.settingCard}>
          <Text variant="label" color="textMuted">
            {t('settings.appearance')}
          </Text>
          <View accessibilityRole="radiogroup" style={styles.options}>
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
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeading title={t('settings.language')} icon="language-outline" />
        <Card style={styles.settingCard}>
          <Text variant="label" color="textMuted">
            {t('settings.language')}
          </Text>
          <View accessibilityRole="radiogroup" style={styles.options}>
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
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeading title={t('settings.notifications')} icon="notifications-outline" />
        <Card style={styles.settingCard}>
          <Checkbox
            testID="push-notifications-toggle"
            label={t('settings.pushNotifications')}
            checked={pushNotificationsEnabled}
            onPress={() => void togglePush()}
          />
          <Text variant="caption" color="textMuted">
            {t('settings.pushNotificationsHint')}
          </Text>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeading title={t('settings.storage')} icon="archive-outline" />
        <Card style={styles.settingCard}>
          <Text color="textMuted">{t('settings.clearCacheHint')}</Text>
          <Button
            testID="clear-cache"
            variant="secondary"
            title={t('settings.clearCache')}
            loading={clearing}
            onPress={() => void clearCache()}
          />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  section: { gap: spacing.sm },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  settingCard: {
    borderRadius: radii.lg,
    gap: spacing.md,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
