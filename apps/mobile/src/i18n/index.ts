import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@haggler/shared';
import en from './locales/en';
import hi from './locales/hi';
import kn from './locales/kn';
import ta from './locales/ta';
import te from './locales/te';

export const resources = {
  en: { translation: en },
  hi: { translation: hi },
  ta: { translation: ta },
  kn: { translation: kn },
  te: { translation: te },
} as const;

/** Each language written in itself, so a user can find theirs even if the UI is unreadable. */
export const LANGUAGE_NATIVE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  kn: 'ಕನ್ನಡ',
  te: 'తెలుగు',
};

export function pickSupportedLanguage(code: string | null | undefined): SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code ?? '')
    ? (code as SupportedLanguage)
    : DEFAULT_LANGUAGE;
}

export function deviceLanguage(): SupportedLanguage {
  return pickSupportedLanguage(getLocales()[0]?.languageCode);
}

void i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false }, // React Native already escapes
  returnNull: false,
});

export default i18n;
