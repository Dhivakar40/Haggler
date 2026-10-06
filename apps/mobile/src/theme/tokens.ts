/**
 * Design tokens. Every colour pair used for text is checked against WCAG AA (4.5:1) in
 * tokens.spec.ts, so a future palette tweak that hurts readability fails CI.
 * Workers use low-end phones outdoors in sunlight, so we favour high contrast.
 *
 * Palette (UI/UX redesign, approved direction): Limestone/Char instead of white/near-black —
 * a warm, cool-neutral stone tone (like the kadappa flooring common in Indian homes and
 * workshops) and a warm near-black with a green undertone. Tilework (primary) is a deep
 * glazed-tile teal-indigo, refined from the original brand teal rather than discarded — evokes
 * courtyard/temple tilework, not a fintech "trustworthy blue." Marigold (warning, reused as the
 * "verified/highlight" accent) is a burnt marigold-amber, used the way a shopkeeper uses a stamp
 * — on a verified badge, a confirmed price — never as a background wash. Banyan (success) and
 * Brick (danger) are a muted leaf green and a grounded brick red.
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
  background: '#F6F4EF', // Limestone
  surface: '#FFFFFF',
  surfaceAlt: '#EAE6DC',
  text: '#1C231F', // Char
  textMuted: '#5B6459',
  border: '#D8D2C4',
  primary: '#0B5E52', // Tilework
  onPrimary: '#FFFFFF',
  danger: '#B3261E', // Brick
  onDanger: '#FFFFFF',
  success: '#3F7D45', // Banyan
  warning: '#A45908', // Marigold
};

export const darkColors: ColorTokens = {
  background: '#121815',
  surface: '#1B221D',
  surfaceAlt: '#242C26',
  text: '#EDEAE1',
  textMuted: '#A7AD9E',
  border: '#374039',
  primary: '#4FBDAE',
  onPrimary: '#052A25',
  danger: '#E06456',
  onDanger: '#2A0805',
  success: '#6FB876',
  warning: '#E8973B',
};

/** 4-pt spacing scale. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Android/iOS accessibility guidance: interactive targets at least 48dp. */
export const MIN_TOUCH_TARGET = 48;

/** Phase UI: Manrope (@expo-google-fonts/manrope), loaded in app/_layout.tsx via useFonts before
 * the app renders. Chosen over a default system/Inter look for a distinct geometric-but-warm
 * voice; not used for Hindi/Tamil/Kannada/Telugu glyphs, which Manrope doesn't cover — both iOS
 * and Android fall back to the system font per-glyph automatically when a font lacks a character,
 * so Indic-script text already renders correctly with no extra handling needed here. Loaded via
 * `useFonts` in `app/_layout.tsx`, which holds the splash screen until the four weights below are
 * ready — the app never renders a frame with the wrong font. */
export const fontFamily = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semiBold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
} as const;

/** `caption` is medium, not regular: at 13px a regular weight reads thin in the Tamil/Kannada/
 * Telugu scripts, which have more intricate glyph shapes than Latin at small sizes.
 *
 * Deliberately no `fontWeight` alongside `fontFamily`: each Manrope file here is already a fixed
 * weight, and Android's font matcher can fail to apply a custom family at all (silently reverting
 * to the system font) when `fontWeight` doesn't match what it expects for that family name — a
 * known expo-google-fonts gotcha. The weight is encoded in which file is referenced, not a style
 * prop. */
export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontFamily: fontFamily.bold },
  heading: { fontSize: 20, lineHeight: 26, fontFamily: fontFamily.semiBold },
  body: { fontSize: 16, lineHeight: 22, fontFamily: fontFamily.regular },
  label: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.semiBold },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.medium },
} as const;
export type TextVariant = keyof typeof typography;

/** Motion: short and purposeful, never decorative. `fast` is for a press/toggle state settling,
 * `base` for a sheet/dialog/toast entrance, `slow` for a full-screen transition or the league-up
 * celebration. Respects the OS "reduce motion" setting at the call site (see Sheet/Dialog/Toast),
 * not baked in here. */
export const motion = { fast: 120, base: 200, slow: 320 } as const;

/**
 * Elevation policy: flat is the default everywhere (Card is flat unless `elevated` is set).
 * Shadow is reserved for surfaces that need the user's attention right now and float above the
 * normal reading order — an active job, an incoming request a Ranger must act on in seconds, a
 * price about to be confirmed. A service-category tile, a booking-history row and a chat bubble
 * are never elevated; they are distinguished from each other by shape and spacing, not by
 * identical card-plus-shadow treatment.
 */
export const elevatedShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.12,
  shadowRadius: 8,
  elevation: 3, // Android
} as const;

/**
 * League badge colors (Phase UI). Same bg/on pairing shape as `ColorTokens`, one fixed value per
 * tier rather than a light/dark pair — a filled badge is a solid chip, not a surface, so it stays
 * the same color in both themes (only the page around it changes). The Ranger ladder reads as
 * materials (wood through diamond, the tier names themselves); the client ladder as a warming
 * progression from neutral to a deep, earned jewel tone. Both ladders deliberately land on the
 * same capstone color as `primary` (Tilework) at their top tier — reaching LEGENDARY/LEGEND means
 * your badge now wears the brand's own color. Every pairing is checked against AA (4.5:1) in
 * tokens.spec.ts, same discipline as the rest of this file.
 */
export const leagueColors: Record<string, { bg: string; on: string }> = {
  // Ranger ladder (D-076)
  WOOD: { bg: '#6B5433', on: '#FFFFFF' },
  STONE: { bg: '#5F6962', on: '#FFFFFF' },
  COPPER: { bg: '#9C5527', on: '#FFFFFF' },
  BRONZE: { bg: '#7A5323', on: '#FFFFFF' },
  SILVER: { bg: '#5E6A70', on: '#FFFFFF' },
  GOLD: { bg: '#8C6400', on: '#FFFFFF' },
  PLATINUM: { bg: '#52626B', on: '#FFFFFF' },
  DIAMOND: { bg: '#276A7A', on: '#FFFFFF' },
  LEGENDARY: { bg: '#0B5E52', on: '#FFFFFF' },
  // Client ladder (D-077)
  NEWCOMER: { bg: '#555F56', on: '#FFFFFF' },
  REGULAR: { bg: '#46545C', on: '#FFFFFF' },
  PREFERRED: { bg: '#8C5207', on: '#FFFFFF' },
  TRUSTED: { bg: '#A4590A', on: '#FFFFFF' },
  LOYAL: { bg: '#8E3324', on: '#FFFFFF' },
  ELITE: { bg: '#6B3F5E', on: '#FFFFFF' },
  CHAMPION: { bg: '#4F3B74', on: '#FFFFFF' },
  PATRON: { bg: '#1E5F6E', on: '#FFFFFF' },
  LEGEND: { bg: '#0B5E52', on: '#FFFFFF' },
};

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
