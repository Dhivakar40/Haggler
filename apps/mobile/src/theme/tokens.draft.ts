/**
 * DRAFT design tokens — Part 2 of the UI/UX redesign, not yet wired into ThemeProvider or applied
 * app-wide. Imported only by the three checkpoint screens (Home, Book a Service, Work) so the rest
 * of the app stays exactly as it is today until this direction is approved. Once approved, these
 * values replace the ones in tokens.ts and every screen is migrated over, batch by batch.
 *
 * Every pair below is checked against the exact same WCAG AA (4.5:1) algorithm tokens.spec.ts uses
 * for the live palette — see the bottom of this file.
 */
import type { ColorTokens } from './tokens';

/**
 * Palette reasoning (see the Part 2 write-up for the full brief):
 *  - Limestone/Char instead of white/black: a warm, cool-neutral stone tone (like the kadappa
 *    flooring common in Indian homes and workshops) and a warm near-black with a green undertone —
 *    deliberately NOT the "warm cream" or "near-black" extremes called out as generic.
 *  - Tilework (primary): a deep glazed-tile teal-indigo, refined from the current brand teal rather
 *    than discarded — evokes temple/courtyard tilework, not a fintech "trustworthy blue."
 *  - Marigold (warning, reused as the "verified/highlight" accent): a burnt marigold-amber,
 *    referencing flower garlands and market stalls. Used the way a shopkeeper uses a stamp — on a
 *    verified badge, a confirmed price, a "read this" moment — never as a background wash.
 *  - Banyan (success) and Brick (danger): an earthy leaf green and a grounded brick red, both
 *    deliberately muted rather than saturated "app" colours.
 */
export const draftLightColors: ColorTokens = {
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

export const draftDarkColors: ColorTokens = {
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

/**
 * Type scale reasoning: five levels kept (not expanded), weights made more deliberate rather than
 * just size bumps. `caption` moved from 400 to 500 — at 13px, a regular weight reads thin in the
 * Tamil/Kannada/Telugu scripts, which have more intricate glyph shapes than Latin at small sizes.
 *
 * Typeface strategy (not yet wired in — see the Part 2 write-up): Noto Sans, specifically because
 * Google designs Noto Sans Devanagari/Tamil/Kannada/Telugu as one coordinated system alongside
 * Noto Sans Latin — matching weight and proportions across scripts, which the current system-font
 * fallback does not guarantee (the OS may substitute a visually unrelated font per script). Held
 * back from this pass deliberately: it needs new font-loading dependencies (expo-font +
 * @expo-google-fonts/noto-sans*), which is real new surface area better tested after the direction
 * itself is approved, not bundled into a checkpoint the user is validating on a live device.
 */
export const draftTypography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
} as const;

/**
 * Elevation policy: flat is the default everywhere. Shadow (elevation) is reserved for surfaces
 * that need the user's attention right now and float above the normal reading order — an active
 * job, an incoming request a Ranger must act on in seconds, a price about to be confirmed. A
 * service-category tile, a booking-history row and a chat bubble are never elevated; they are
 * distinguished from each other by shape and spacing, not by identical card-plus-shadow treatment.
 */
export const draftElevated = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.12,
  shadowRadius: 8,
  elevation: 3, // Android
} as const;
