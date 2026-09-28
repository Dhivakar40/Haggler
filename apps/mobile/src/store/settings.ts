import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { SupportedLanguage } from '@haggler/shared';

export type ThemeMode = 'system' | 'light' | 'dark';

interface SettingsState {
  themeMode: ThemeMode;
  /** null = follow the device language. */
  language: SupportedLanguage | null;
  setThemeMode: (mode: ThemeMode) => void;
  setLanguage: (lang: SupportedLanguage | null) => void;
}

/** Device-local UI preferences only. Nothing sensitive is stored here. */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      language: null,
      setThemeMode: (themeMode) => set({ themeMode }),
      setLanguage: (language) => set({ language }),
    }),
    { name: 'haggler.settings.v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
