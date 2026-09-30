import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useSession } from '../auth/session';
import { TrackerHost } from '../features/work/TrackerHost';
import { defineBackgroundTask } from '../location/tracker';
import { RealtimeProvider } from '../realtime/RealtimeProvider';
import i18n, { deviceLanguage } from '../i18n';
import { configureNotificationHandler } from '../notifications/push';
import { usePushRegistration } from '../notifications/usePushRegistration';
import { useSettings } from '../store/settings';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';

// The OS can wake this task with new positions even when no screen is showing, so it is
// registered at startup rather than inside a component.
defineBackgroundTask();
configureNotificationHandler();

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
  // Select booleans, not `s.user?.missingConsents ?? []` — that `?? []` allocates a new array
  // reference on every call, so useSyncExternalStore's getSnapshot never sees a stable value and
  // re-renders in an infinite loop ("The result of getSnapshot should be cached").
  const missingTerms = useSession(
    (s) => s.user?.missingConsents.includes('TERMS_OF_SERVICE') ?? false,
  );
  const missingPrivacy = useSession(
    (s) => s.user?.missingConsents.includes('PRIVACY_POLICY') ?? false,
  );
  const signedIn = status === 'signedIn';
  const needsConsent = signedIn && (missingTerms || missingPrivacy);
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
        <Stack.Screen name="wallet" options={{ ...header, title: t('wallet.title') }} />
        <Stack.Screen
          name="blocked-users"
          options={{ ...header, title: t('account.blockedUsers') }}
        />
        <Stack.Screen
          name="ranger-reviews/[id]"
          options={{ ...header, title: t('job.reviewsTitle') }}
        />
        <Stack.Screen name="request/new" options={{ ...header, title: t('request.title') }} />
        <Stack.Screen name="request/[id]" options={{ ...header, title: t('request.title') }} />
        <Stack.Screen name="job/[id]" options={{ ...header, title: t('job.title') }} />
        <Stack.Screen name="chat/[jobId]" options={{ ...header, title: t('chat.title') }} />
        <Stack.Screen
          name="contracts/index"
          options={{ ...header, title: t('employer.browseTitle') }}
        />
        <Stack.Screen
          name="contracts/[id]"
          options={{ ...header, title: t('employer.listingTitle') }}
        />
        <Stack.Screen
          name="contracts/my-applications"
          options={{ ...header, title: t('employer.myApplicationsTitle') }}
        />
        <Stack.Screen
          name="employer/profile"
          options={{ ...header, title: t('employer.profileTitle') }}
        />
        <Stack.Screen
          name="employer/listings/index"
          options={{ ...header, title: t('employer.myListingsTitle') }}
        />
        <Stack.Screen
          name="employer/listings/new"
          options={{ ...header, title: t('employer.postListing') }}
        />
        <Stack.Screen
          name="employer/listings/[id]"
          options={{ ...header, title: t('employer.applicantsTitle') }}
        />
        <Stack.Screen name="campus/index" options={{ ...header, title: t('campus.browseTitle') }} />
        <Stack.Screen name="campus/[id]" options={{ ...header, title: t('campus.listingTitle') }} />
        <Stack.Screen
          name="campus/my-applications"
          options={{ ...header, title: t('employer.myApplicationsTitle') }}
        />
        <Stack.Screen
          name="student/profile"
          options={{ ...header, title: t('campus.profileTitle') }}
        />
        <Stack.Screen
          name="employer/campus/index"
          options={{ ...header, title: t('campus.myListingsTitle') }}
        />
        <Stack.Screen
          name="employer/campus/new"
          options={{ ...header, title: t('employer.postListing') }}
        />
        <Stack.Screen
          name="employer/campus/[id]"
          options={{ ...header, title: t('employer.applicantsTitle') }}
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
  usePushRegistration(status === 'signedIn');

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
          <RealtimeProvider>
            <ThemeProvider>
              <ThemedStatusBar />
              <TrackerHost />
              <Navigator />
            </ThemeProvider>
          </RealtimeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
