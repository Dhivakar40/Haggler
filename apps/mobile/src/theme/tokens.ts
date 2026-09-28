/**
 * Design tokens. Every colour pair used for text is checked against WCAG AA (4.5:1) in
 * tokens.spec.ts, so a future palette tweak that hurts readability fails CI.
 * Workers use low-end phones outdoors in sunlight, so we favour high contrast.
 */
export interface ColorTokens {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
  danger: string;
  onDanger: string;
  success: string;
  warning: string;
}

export const lightColors: ColorTokens = {
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceAlt: '#E2E8F0',
  text: '#0F172A',
  textMuted: '#475569',
  border: '#CBD5E1',
  primary: '#0F766E',
  onPrimary: '#FFFFFF',
  danger: '#B91C1C',
  onDanger: '#FFFFFF',
  success: '#15803D',
  warning: '#B45309',
};

export const darkColors: ColorTokens = {
  background: '#0B1220',
  surface: '#131C2E',
  surfaceAlt: '#1E293B',
  text: '#F1F5F9',
  textMuted: '#A5B4C8',
  border: '#334155',
  primary: '#2DD4BF',
  onPrimary: '#042F2E',
  danger: '#F87171',
  onDanger: '#2A0A0A',
  success: '#4ADE80',
  warning: '#FBBF24',
};

/** 4-pt spacing scale. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Android/iOS accessibility guidance: interactive targets at least 48dp. */
export const MIN_TOUCH_TARGET = 48;

export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
} as const;
export type TextVariant = keyof typeof typography;

// --- WCAG contrast helpers (used by tests) -------------------------------------------

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG contrast ratio, 1 (none) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}
