import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useSettings } from '../store/settings';
import { type ColorTokens, darkColors, lightColors } from './tokens';

export interface Theme {
  scheme: 'light' | 'dark';
  colors: ColorTokens;
}

const ThemeContext = createContext<Theme>({ scheme: 'light', colors: lightColors });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useSettings((s) => s.themeMode);
  const device = useColorScheme();
  const scheme: Theme['scheme'] = mode === 'system' ? (device === 'dark' ? 'dark' : 'light') : mode;
  const value = useMemo<Theme>(
    () => ({ scheme, colors: scheme === 'dark' ? darkColors : lightColors }),
    [scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): Theme => useContext(ThemeContext);
