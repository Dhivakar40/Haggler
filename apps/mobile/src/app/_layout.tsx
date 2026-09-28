import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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

export default function RootLayout() {
  // One client per app session. Retry once: workers are often on flaky mobile data.
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  const hydrated = useSettingsHydrated();
  useLanguageSync();

  // Avoid flashing the wrong theme/language before saved settings load.
  if (!hydrated) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ThemedStatusBar />
            <Stack screenOptions={{ headerShown: false }} />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
