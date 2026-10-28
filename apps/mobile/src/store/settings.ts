import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { SupportedLanguage } from '@haggler/shared';

export type ThemeMode = 'system' | 'light' | 'dark';

interface SettingsState {
  themeMode: ThemeMode;
  /** null = follow the device language. */
  language: SupportedLanguage | null;
  /** Off = this device's push token is cleared server-side; nothing is sent to it. */
  pushNotificationsEnabled: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setLanguage: (lang: SupportedLanguage | null) => void;
  setPushNotificationsEnabled: (enabled: boolean) => void;
}

/** Device-local UI preferences only. Nothing sensitive is stored here. */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      language: null,
      pushNotificationsEnabled: true,
      setThemeMode: (themeMode) => set({ themeMode }),
      setLanguage: (language) => set({ language }),
      setPushNotificationsEnabled: (pushNotificationsEnabled) =>
        set({ pushNotificationsEnabled }),
    }),
    { name: 'haggler.settings.v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
