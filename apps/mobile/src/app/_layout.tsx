import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useSession } from '../auth/session';
import i18n, { deviceLanguage } from '../i18n';
import { useSettings } from '../store/settings';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';

/** Keeps i18next in step with the saved language (or the device language when unset). */
function useLanguageSync(): void {
  const language = useSettings((s) => s.language);
  useEffect(() => {
    void i18n.changeLanguage(language ?? deviceLanguage());
  }, [language]);
}

function useSettingsHydrated(): boolean {
  const [hydrated, setHydrated] = useState(useSettings.persist.hasHydrated());
  useEffect(() => {
    const unsub = useSettings.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useSettings.persist.hasHydrated());
    return unsub;
  }, []);
  return hydrated;
}

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

/**
 * Three mutually exclusive worlds, chosen by the session:
 *  - signed out            -> sign-in screens only
 *  - signed in, no consent -> the consent screen only (DPDP: explicit consent before use)
 *  - signed in + consented -> the app
 * `Stack.Protected` makes the other routes unreachable, even by deep link.
 */
function Navigator() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const status = useSession((s) => s.status);
  const missing = useSession((s) => s.user?.missingConsents ?? []);
  const signedIn = status === 'signedIn';
  const needsConsent =
    signedIn && (missing.includes('TERMS_OF_SERVICE') || missing.includes('PRIVACY_POLICY'));
  const header = {
    headerShown: true,
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.text,
    headerShadowVisible: false,
  } as const;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="legal/index" options={{ ...header, title: t('legal.title') }} />
        <Stack.Screen name="legal/[doc]" options={{ ...header, title: t('legal.title') }} />
      </Stack.Protected>

      <Stack.Protected guard={needsConsent}>
        <Stack.Screen name="consent" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && !needsConsent}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" options={{ ...header, title: t('profile.title') }} />
        <Stack.Screen name="addresses" options={{ ...header, title: t('addresses.title') }} />
        <Stack.Screen name="address-new" options={{ ...header, title: t('addresses.newTitle') }} />
        <Stack.Screen name="contacts" options={{ ...header, title: t('contacts.title') }} />
        <Stack.Screen name="ranger" options={{ ...header, title: t('ranger.title') }} />
        <Stack.Screen name="kyc/[tier]" options={{ ...header, title: t('ranger.title') }} />
        <Stack.Screen
          name="delete-account"
          options={{ ...header, title: t('deleteAccount.title') }}
        />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  // One client per app session. Retry once: Rangers are often on flaky mobile data.
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  const hydrated = useSettingsHydrated();
  const status = useSession((s) => s.status);
  useLanguageSync();

  useEffect(() => {
    void useSession.getState().bootstrap();
  }, []);

  // Signing out (or switching account) must not leave the previous person's data in the cache.
  useEffect(() => {
    if (status === 'signedOut') queryClient.clear();
  }, [status, queryClient]);

  // Avoid flashing the wrong theme, language or screen before saved state loads.
  if (!hydrated || status === 'loading') return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ThemedStatusBar />
            <Navigator />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
