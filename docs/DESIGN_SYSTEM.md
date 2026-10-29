# Haggler Mobile — Design System (Phase UI)

## Visual direction, in five lines

Haggler looks like a well-kept neighbourhood workshop, not a fintech dashboard. The palette —
Limestone (warm stone, like kadappa flooring), Char (a warm near-black), Tilework (a deep glazed
teal-indigo primary, evoking courtyard tilework) — was already chosen before this phase and is kept,
not replaced, because it already does the job: it reads as grounded and local rather than generic
SaaS blue-on-white, it already passes WCAG AA everywhere, and both light and dark modes already
exist. Marigold (the accent used for verified badges and confirmed prices) is used the way a
shopkeeper uses a stamp — on the moment that matters, never as a background wash. A trust-focused
local-services marketplace in India earns trust the way the people on it do: by being plain,
legible, and specific about what's happening right now, not by looking impressive.

## What's new in this phase

Everything in `theme/tokens.ts` from before Phase UI — `ColorTokens`, light/dark palettes, the 4pt
spacing scale, radii, `MIN_TOUCH_TARGET`, the elevation policy, the WCAG contrast helpers — is
unchanged. This phase adds:

- **A typeface.** Manrope (`@expo-google-fonts/manrope`), four weights (400/500/600/700), loaded via
  `useFonts` in `app/_layout.tsx`, which holds the native splash screen until the fonts are ready —
  the app never renders a frame in the system font by mistake. Manrope is used for Latin-script text
  only; Hindi/Tamil/Kannada/Telugu glyphs aren't in the font, and both iOS and Android already fall
  back to the system font per-glyph when a font lacks a character, so Indic-script text keeps
  rendering correctly with no extra code. `typography` variants in `tokens.ts` carry `fontFamily`
  but deliberately no `fontWeight` — mixing both with a per-weight static font file is a known
  Android gotcha (the custom family can silently fail to apply). The weight lives in which file is
  referenced, not a style prop.
- **Motion durations** (`motion.fast/base/slow` — 120/200/320ms) for the handful of places something
  actually animates: a sheet or dialog entrance, a toast, the league-up celebration, a skeleton's
  pulse. Nothing animates decoratively.
- **League badge colors** (`leagueColors`, in `tokens.ts`) — one fixed `{ bg, on }` pair per tier,
  covering all nine Ranger tiers and all nine client tiers, each checked against WCAG AA in
  `tokens.spec.ts`. The Ranger ladder reads as materials (the tier names themselves — wood through
  diamond); the client ladder as a warming progression from neutral to an earned jewel tone. Both
  ladders land on the same color as `primary` at their top tier (LEGENDARY / LEGEND) — reaching the
  top means your badge now wears the brand's own color, not a louder version of a lower tier's.

## Component library

Every screen in Phase UI is built only from these — no one-off `StyleSheet` for something this list
already covers. `src/components/index.ts` is the single import surface.

**Already existed, unchanged in API:**
`Button`, `Card`, `Checkbox`, `Chip`, `Countdown`, `Screen`, `EmptyState`/`ErrorState`/`LoadingState`,
`Text`, `TextField` (the app's `Input`), `TrackingMap`, `LeagueUpModal`.

**New this phase:**

| Component | What it's for |
|---|---|
| `Avatar` | A person's photo, or their initials on a deterministic tint from a small, fixed set of league-badge colors (the same name always gets the same tint — not a random bright color outside the palette). |
| `Badge` | A small, non-interactive role/count marker (`accent` or `neutral` tone). Never implies status — that's `StatusPill`. |
| `StatusPill` | The one status-color pill for the whole app (`neutral`/`positive`/`negative`/`warning`). Callers map their own domain's status string to a tone via a small lib helper (`lib/status-tone.ts` for the Contracts/Campus application and listing statuses) rather than each screen inventing its own color map — this replaced six copy-pasted `STATUS_COLOR` records (`docs/UI_AUDIT.md` §11.3). |
| `LeagueBadge` | The one league-tier pill, covering all 18 tiers across both ladders, translated via the existing `league.tier.*` / `clientLeague.tier.*` i18n keys. Renders nothing for an unrecognized tier rather than a broken pill. |
| `PriceTag` | Routes every price display through `lib/money.ts`'s `formatRupees`, so money is never formatted two different ways in two different screens. `default` (heading weight, a confirmed price) or `muted` (a reference figure next to one). |
| `ListRow` | The one tappable-row pattern: a settings menu item, an address, an activity-list entry. Optional leading icon, subtitle, and trailing content (defaults to a chevron when `onPress` is set). Replaces the one-off address-picker row in `NewRequestScreen.tsx` and is the building block for the `AccountScreen.tsx` rework (`docs/UI_AUDIT.md` §11.1, §11.10). |
| `Sheet` | A bottom sheet for a temporary extension of the current screen — an action menu, a filter panel. Closes on backdrop tap or the hardware back button. |
| `Dialog` | The app's own confirmation dialog, replacing `Alert.alert()`'s OS-styled native look for the app's "ask first" moments (cancel a job, sign out, delete an account) with the app's own visual language. `destructive` routes the confirm button through `Button`'s `danger` variant. |
| `Skeleton` / `ToastHost` | A loading placeholder block (screens compose several into a rough layout match, not one generic spinner) and the app's one toast surface (`showToast()` from `store/toast-queue.ts`), mounted once globally in `app/_layout.tsx`. Both are queue/animation-driven the same way `LeagueUpModal` already was — `ToastHost` shows one toast at a time, a second queued while one is showing waits its turn. `Skeleton`'s pulse respects the OS "reduce motion" setting. |

## Testing conventions this phase settled

Writing tests for `Sheet`/`Dialog`/`Toast` surfaced two real `test-utils.tsx` / RNTL gaps worth
noting for every screen test from here on:

- **`renderWithProviders` now wraps in `SafeAreaProvider`** with a fixed `initialMetrics` (a stable,
  arbitrary phone frame). Any component reading `useSafeAreaInsets()` — `Sheet`, `ToastHost`, and any
  screen built on them — threw "No safe area value available" without this.
- **RNTL excludes `accessibilityElementsHidden`/`importantForAccessibility="no-hide-descendants"`
  elements from default queries.** `Skeleton` is deliberately hidden from assistive tech (it's a
  placeholder, not content) — its own test queries with `{ includeHiddenElements: true }` to see it
  anyway. Any other intentionally-hidden element needs the same.
- **`jest.useFakeTimers()` needs `{ doNotFake: ['queueMicrotask'] }`** whenever the test also renders
  a component — bare fake timers can interfere with React's own internal scheduling and leave the
  tree empty. Already the convention in `job.spec.tsx` (D-078's confirm-then-check-league tests);
  `Toast.spec.tsx` follows the same pattern.

## Known follow-ups, not fixed in this phase

- `app.json`'s Android adaptive-icon background (`#0F766E`) is a close but not exact match for
  `colors.primary` (`#0B5E52`) — an app-icon asset change, out of scope for a code-only pass.
- The two screens already flagged in `docs/UI_AUDIT.md` as "no visual treatment yet"
  (`ranger/LeagueScreen.tsx`, `account/ClientLeagueScreen.tsx`) are rebuilt using `LeagueBadge` in
  Step 3 of the screen work, not here.

## D-109: teammate redesign ported (branch `ui/teammate-redesign`)

A teammate redesigned 6 screens on an older snapshot of the app (base commit `6dd04dd`, see
`docs/ui-port/PLAN.md` and `docs/ui-port/REPORT.md` for the full evidence and file-by-file
breakdown). No new component, token, color, font or dependency was introduced — every change is
screen-level composition built from the *existing* kit (`Card`, `Badge`, `Chip`, `Button`,
`ListRow`, `Text`) plus inline `@expo/vector-icons` and `StyleSheet`. The recurring patterns, now
established conventions for any future screen in this style:

- **Icon-led section headers**: a `48×48` (or `42×42` for a nested sub-header) `colors.surfaceAlt`
  square, `radii.md`, holding a centered `-outline` icon in `colors.primary`, next to the title.
- **`SectionHeading`**: a small local component (icon + `variant="label"` or `variant="heading"`
  text) placed above a `Card` that groups related `ListRow`s or controls — used on
  `SettingsScreen.tsx` and `AccountScreen.tsx`. Kept as a per-file local component rather than
  promoted into `components/`, since the two usages differ slightly (label weight vs icon size) and
  a single shared version wasn't worth the coupling for two call sites.
- **Status dot + badge**: a small colored circle (`radii.pill`, ~7-9px) next to a
  `colors.surfaceAlt` pill badge, used for online/offline presence and job status instead of color
  alone — same information, now carried redundantly through shape/position too, not just hue.
- **Flat list rows become `Card` tiles**: `HomeScreen`'s category grid and `ActivityScreen`'s job
  list moved from hairline-divided rows to individually-bordered, `radii.lg` cards with a tinted
  icon shell, following the existing elevation policy (flat unless the surface needs the user's
  attention right now).

This port only touched `apps/mobile/src/app/(tabs)/_layout.tsx` and
`features/{home,activity,settings,work,account}`; `theme/tokens.ts`, `ThemeProvider.tsx`,
`components/*`, and `apps/admin` were untouched by the original redesign and remain untouched here.
