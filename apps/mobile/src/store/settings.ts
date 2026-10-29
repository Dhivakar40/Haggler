import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { SupportedLanguage } from '@haggler/shared';

export type ThemeMode = 'system' | 'light' | 'dark';

interface SettingsState {
  themeMode: ThemeMode;
  /** null = follow the device language. */
  language: SupportedLanguage | null;
  /** D-113: off by default — the OS permission prompt only fires when a person explicitly
   * switches this on (onboarding's Preferences step, or Settings), never automatically at
   * sign-in. Off = this device's push token is cleared server-side; nothing is sent to it. */
  pushNotificationsEnabled: boolean;
  /** D-113: same rule as push — only requested when explicitly switched on. A convenience flag
   * for screens that want to know "has this person said yes to location"; it does not itself
   * gate anything today (see onboarding's Preferences step and docs/DECISIONS.md D-113). */
  locationEnabled: boolean;
  /** D-113: collected at onboarding's Preferences step for a feature not designed yet — kept
   * device-local (not sent to the server) until a real use for it exists. Service-category
   * slugs, e.g. "electrician", matching `ServiceCategoryDto.slug`. */
  preferredCategorySlugs: string[];
  setThemeMode: (mode: ThemeMode) => void;
  setLanguage: (lang: SupportedLanguage | null) => void;
  setPushNotificationsEnabled: (enabled: boolean) => void;
  setLocationEnabled: (enabled: boolean) => void;
  setPreferredCategorySlugs: (slugs: string[]) => void;
}

/** Device-local UI preferences only. Nothing sensitive is stored here. */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      language: null,
      pushNotificationsEnabled: false,
      locationEnabled: false,
      preferredCategorySlugs: [],
      setThemeMode: (themeMode) => set({ themeMode }),
      setLanguage: (language) => set({ language }),
      setPushNotificationsEnabled: (pushNotificationsEnabled) =>
        set({ pushNotificationsEnabled }),
      setLocationEnabled: (locationEnabled) => set({ locationEnabled }),
      setPreferredCategorySlugs: (preferredCategorySlugs) => set({ preferredCategorySlugs }),
    }),
    { name: 'haggler.settings.v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
