# Haggler Mobile — UI/UX Audit

Scope: `apps/mobile/src/` — every screen under `src/features/*` and its route wrapper under
`src/app/`, plus the theme system and shared component library. Written before Phase UI (the full
visual/UX overhaul); nothing in this document changes behavior on its own.

**Headline finding:** this is not a stock/template codebase. There is already a deliberate, named
design direction in `theme/tokens.ts` (the "Limestone/Char/Tilework" palette, a 4pt spacing scale,
an explicit elevation policy, WCAG-checked contrast) and nearly every screen already consumes the
shared component kit (`Screen/Card/Button/Text/Chip/TextField/...`) rather than rolling its own
styling. The redesign's real work is: (a) finishing the two screens explicitly marked in-code as
"functional only, no visual treatment yet" (Ranger League, Client League), (b) a handful of concrete
fixable issues listed in §11, (c) choosing and committing to a visual direction (today everything is
plain — title + muted subtitle + stacked full-width cards — correct but with little hierarchy beyond
type size), and (d) extracting a few duplicated patterns (status-color pills, star ratings) into real
shared components before they're styled per the new direction in six different places.

No dummy/dead buttons were found anywhere — every `onPress` invokes a real handler. No emoji usage
was found anywhere in UI-facing strings. These are both already true, not gaps to close.

---

## 1. Customer screens

| # | File | Role(s) | What it does | Problems found | Shared components? |
|---|---|---|---|---|---|
| 1 | `src/features/home/HomeScreen.tsx` | Customer (Home tab) | Service-category directory; tapping a category starts a new request | Icon name comes from API data (`cat.icon as keyof typeof Ionicons.glyphMap`) with no fallback if the backend ever sends a bad slug. No dummy buttons. Deliberately flat. | Full: `Screen, Text, EmptyState, ErrorState, LoadingState` |
| 2 | `src/features/activity/ActivityScreen.tsx` | Customer + Ranger | List of the signed-in user's requests/jobs | None structural. | `Card, Chip, EmptyState, ErrorState, LoadingState, Screen, Text` |
| 3 | `src/features/request/NewRequestScreen.tsx` | Customer | Create a service request (description, address, time, photos, voice note, gender preference, price-band preview, the "Other" category flow) | Address list uses a hand-rolled "list-group" (`Pressable` rows + `radio-button-on/off`) instead of the shared `Chip`/`Checkbox` radio pattern used everywhere else — a second "selectable row" visual language. No LoadingState/EmptyState for the address list (plain `Text` fallback only). | Partial — mostly shared kit, address-row UI is bespoke |
| 4 | `src/features/request/RequestStatusScreen.tsx` | Customer | Post-request waiting screen: countdown, rebroadcast/cancel/rush | Clean. | Full: `Button, Card, Countdown, ErrorState, LoadingState, Screen, Text` |
| 5 | `src/features/job/JobScreen.tsx` | Customer + Ranger | The in-progress job: status, price, counterpart info, negotiation, actions, review, chat entry | "Block user" is a `Text` with `accessibilityRole="button"`, not a real `Button`/`Pressable` — text masquerading as an interactive element. | Mostly shared; block-link is a one-off |
| 6 | `src/features/job/CustomerActions.tsx` | Customer | Live tracking map, arrival-code reveal, confirm/no-show/share/cancel | Arrival-code digits use an ad hoc inline size (`fontSize: 48, letterSpacing: 8`) instead of a typography-token variant. | Shared (`Button, Card, Text, TrackingMap`) |
| 7 | `src/features/job/NegotiationPanel.tsx` | Customer + Ranger | Offer/counter/accept/reject panel with band and round tracking | Correct elevation-policy usage (elevates only when there's a pending counterpart offer). One dead-code smell: a no-op `.slice(0, 0)` left in — not visual, flagged for cleanup. | Shared (`Button, Card, Countdown, Text, TextField`) |
| 8 | `src/features/job/ReviewPrompt.tsx` | Customer + Ranger | Post-job star rating + comment | `StarPicker` is a bespoke `Ionicons star/star-outline` + `Pressable` implementation, duplicated almost verbatim in `RangerReviewsScreen.tsx`'s `Stars`. | Shared kit elsewhere; star UI is a duplicated one-off |
| 9 | `src/features/job/RangerReviewsScreen.tsx` | Customer | A Ranger's public reviews | Same duplicated `Stars` renderer. | Shared `Card, EmptyState, ErrorState, LoadingState, Screen, Text` + duplicate star component |
| 10 | `src/features/chat/ChatScreen.tsx` | Customer + Ranger | In-app chat thread for a job | Chat bubbles are a reasonable hand-rolled `StyleSheet`, theme-driven, no stray colors. Send button correctly disables when empty. | Shared kit; bubble styling is a necessary one-off |
| 11 | `src/features/kyc/KycScreen.tsx` | Customer → Ranger (KYC onboarding) | Tier-1/Tier-2 document upload, reference contact, consent gate | Long but consistent; repetitive `Card` document blocks. | Full shared kit |
| 12 | `src/features/account/AccountScreen.tsx` | All roles (hub) | Profile summary, role badges, upsell cards, navigation, sign out/delete | **The single biggest "stack of ~15 full-width buttons" screen in the app** — no grouping, no icons, no hierarchy beyond primary/secondary/danger. Strongest candidate for a real settings-list/menu-row information-architecture rework. | Full shared kit |
| 13 | `src/features/account/ProfileScreen.tsx` | All roles | Edit name/email/DOB/gender/languages | Clean. | Full |
| 14 | `src/features/account/PersonalDetailsFields.tsx` (shared partial) | All roles | DOB (3 digit fields)/gender/email sub-form, reused by onboarding + profile | DOB as 3 raw `TextField`s rather than a date-picker — a documented deliberate cross-platform choice, not an oversight. | Shared |
| 15 | `src/features/account/AddressesScreens.tsx` → `AddressesScreen` | Customer | List/manage saved addresses | Clean. | Full |
| 16 | `src/features/account/AddressesScreens.tsx` → `NewAddressScreen` | Customer | Add address, GPS autofill | Clean, status color correctly token-driven. | Full |
| 17 | `src/features/account/ContactsScreen.tsx` | Customer | Emergency contacts | Clean. | Full |
| 18 | `src/features/account/BlockedUsersScreen.tsx` | Customer + Ranger | Blocked users + unblock | Clean. | Full |
| 19 | `src/features/account/DeleteAccountScreen.tsx` | All roles | Account-deletion confirmation | Clean. | Full |
| 20 | `src/features/account/ClientLeagueScreen.tsx` | Customer | Customer loyalty league ladder | **Explicitly flagged in-code as placeholder-grade** ("Functional only... Part H gives both their real visual treatment"). Progress bar is a hand-rolled width-percent `View`. | Shared `Card, ErrorState, LoadingState, Screen, Text`; bar is custom |
| 21 | `src/features/wallet/WalletScreen.tsx` | Customer + Employer | Token balance, Plus plans, bundles, order history, sandbox checkout | Long but consistent. "Razorpay pending" surfaces a known non-functional real-payment-provider path directly in UI text — a real pending-integration gap, not a visual defect. | Full shared kit |
| 22 | `src/features/legal/LegalScreens.tsx` → `LegalListScreen` | All roles | Legal doc list | Uses `PlaceholderBanner`, which **hardcodes `borderColor: '#B45309'`** instead of a theme token — the one clear hardcoded-color bug found. | Shared, minus the one hardcoded color |
| 23 | `src/features/legal/LegalScreens.tsx` → `LegalDocScreen` | All roles | Legal doc body / grievance-officer contact | Body text is explicitly placeholder copy pending legal counsel. Same hardcoded-hex banner. | Same as above |

## 2. Ranger screens

| # | File | Role(s) | What it does | Problems found | Shared components? |
|---|---|---|---|---|---|
| 1 | `src/features/work/WorkScreen.tsx` | Ranger (Work tab) | Go online/offline, incoming requests + countdown, accept/decline, active job, category filter | Well-executed elevation policy. `tier < 2` gate correctly routes to verification. | Full shared kit |
| 2 | `src/features/work/TrackerHost.tsx` | Ranger | Headless background-location sender | N/A — no UI. | N/A |
| 3 | `src/features/job/RangerActions.tsx` | Ranger | En-route/arrive/verify-code/photos/payment/finish | Button variant toggles primary↔secondary by photo-taken state — intentional, consistent. | Full shared kit |
| 4 | `src/features/ranger/RangerScreen.tsx` | Ranger | KYC tier 1/2 status, "become verified" CTA, category picker | Clean `TierCard` abstraction. | Full shared kit |
| 5 | `src/features/ranger/LeagueScreen.tsx` | Ranger | Ranger loyalty league ladder + stats | **Same explicit "functional only, no visual treatment yet" flag**, referencing "Part H… progress rings, league badges/icons." The clearest intentionally-deferred screen in the whole app. | Shared `Card, ErrorState, LoadingState, Screen, Text`; bar hand-rolled |
| 6 | `src/features/kyc/KycScreen.tsx` | Ranger | Same screen as Customer §1 row 11 | (see above) | Full shared kit |
| 7 | `src/features/contracts/BrowseContractsScreen.tsx` | Ranger | Browse open contract-labour listings | Clean. | Full shared kit |
| 8 | `src/features/contracts/ContractDetailScreen.tsx` | Ranger | View/apply/withdraw a contract listing | Clean. | Full shared kit |
| 9 | `src/features/contracts/MyApplicationsScreen.tsx` | Ranger | Own applications, status color-coded | `STATUS_COLOR` is a local `Record` **duplicated verbatim across 6 files** (this one, `MyListingsScreen`, `ListingApplicantsScreen`, `MyCampusApplicationsScreen`, `MyCampusListingsScreen`, `CampusApplicantsScreen`). | Shared `Card, EmptyState, ErrorState, LoadingState, Screen, Text` |

## 3. Employer / Contract-poster screens

| # | File | Role(s) | What it does | Problems found | Shared components? |
|---|---|---|---|---|---|
| 1 | `src/features/contracts/EmployerProfileScreen.tsx` | Employer | Set/update business name | Clean. | Full shared kit |
| 2 | `src/features/contracts/MyListingsScreen.tsx` | Employer | Own postings, status + applicant counts | Duplicated `STATUS_COLOR` map. | Full shared kit |
| 3 | `src/features/contracts/PostListingScreen.tsx` | Employer | Create a contract-labour listing | Long but consistent; near-identical structure to `PostCampusListingScreen`. | Full shared kit |
| 4 | `src/features/contracts/ListingApplicantsScreen.tsx` | Employer | Shortlist/reject/hire, close, boost (paid) | Duplicated `STATUS_COLOR` map; sandbox-only boost payment (same caveat as Wallet). | Full shared kit |
| 5 | `src/app/employer/profile.tsx`, `employer/listings/*`, `employer/campus/*` | Employer | Thin route re-exports | N/A. | N/A |

**Cross-cutting:** `PostListingScreen`/`PostCampusListingScreen`, `MyListingsScreen`/`MyCampusListingsScreen`,
`ListingApplicantsScreen`/`CampusApplicantsScreen`, `BrowseContractsScreen`/`BrowseCampusScreen`,
`ContractDetailScreen`/`CampusDetailScreen`, `MyApplicationsScreen`/`MyCampusApplicationsScreen` are
six pairs of ~80%-identical screens (Contracts and Campus are genuinely separate product surfaces,
not an accident). Worth deciding whether to factor a shared "listing marketplace" template during
the redesign, parameterized by domain.

## 4. Student / Campus screens

| # | File | Role(s) | What it does | Problems found | Shared components? |
|---|---|---|---|---|---|
| 1 | `src/features/campus/BrowseCampusScreen.tsx` | Student | Browse open campus-job listings | Clean. | Full shared kit |
| 2 | `src/features/campus/CampusDetailScreen.tsx` | Student | View listing, night-shift opt-in, apply/withdraw | Night-shift yes/no uses two `Chip`s as a toggle — stylistically consistent with other binary choices elsewhere, just noted. | Full shared kit |
| 3 | `src/features/campus/MyCampusApplicationsScreen.tsx` | Student | Own applications | Duplicated `STATUS_COLOR` map. | Full shared kit |
| 4 | `src/features/campus/MyCampusListingsScreen.tsx` | Employer (campus-poster) | Own campus postings | Duplicated `STATUS_COLOR` map. | Full shared kit |
| 5 | `src/features/campus/PostCampusListingScreen.tsx` | Employer (campus-poster) | Create a campus listing | Near-duplicate of `PostListingScreen`. | Full shared kit |
| 6 | `src/features/campus/CampusApplicantsScreen.tsx` | Employer (campus-poster) | Review/shortlist/reject/hire, boost, close | Duplicated `STATUS_COLOR` map; sandbox-only boost payment. | Full shared kit |
| 7 | `src/features/campus/StudentProfileScreen.tsx` | Student | One-time DOB (18+ gate) + institute name | **DOB entered as a single free-text `YYYY-MM-DD` field**, validated by regex, no format hint in the UI — a real inconsistency against the 3-digit-field DOB pattern used everywhere else (`PersonalDetailsFields.tsx`). | Shared kit, inconsistent DOB pattern |

## 5. Shared / Auth / Onboarding / Settings / Legal screens

| # | File | Role(s) | What it does | Problems found | Shared components? |
|---|---|---|---|---|---|
| 1 | `src/features/auth/PhoneScreen.tsx` | Unauthenticated | Enter phone, send OTP | Clean. | Full shared kit |
| 2 | `src/features/auth/OtpScreen.tsx` | Unauthenticated | Enter OTP, remember-me, resend cooldown | Clean. | Full shared kit |
| 3 | `src/features/auth/ConsentScreen.tsx` | Signed-in, pre-consent | Explicit Terms + Privacy consent (DPDP) | Uses `PlaceholderBanner` (hardcoded hex, see §11). | Shared, minus placeholder banner |
| 4 | `src/features/onboarding/OnboardingScreen.tsx` | Signed-in, profile-incomplete | Mandatory name/DOB/gender/email setup | Clean. | Full shared kit |
| 5 | `src/features/legal/LegalScreens.tsx` | All signed-in roles | Legal doc list + doc body + grievance contact | Hardcoded hex (see §11); body text explicitly placeholder pending counsel. | Mostly shared |
| 6 | `src/app/(tabs)/_layout.tsx` | All roles | Bottom tab bar (Home/Activity/Work[Ranger]/Account/Settings) | Icon names are bare string literals, not a central icon map. `tabBarLabelStyle` hardcodes `fontSize: 13, fontWeight: '600'` instead of reusing `typography.label`. | N/A (navigator chrome) |
| 7 | `src/app/_layout.tsx` | All roles | Session-routing guard, theme/status-bar wiring, league-up modal mount | Not a visual screen; headers are correctly theme-driven. | N/A |
| 8 | `src/features/settings/SettingsScreen.tsx` | All roles | Theme mode, language, live server-status panel | Clean, token-driven throughout. | Full shared kit |
| 9 | `src/components/LeagueUpModal.tsx` | All roles (global) | League-up celebration modal | Clean, elevated per policy. | Is itself a shared component |

---

## 6. Theme system inventory

### `src/theme/tokens.ts`

A deliberate, named palette — **not** a generic Material/iOS default. In-file comments mark this as
an **already-approved redesign direction** ("Palette (UI/UX redesign, approved direction):
Limestone/Char…") — Phase UI should decide explicitly whether it supersedes or builds on this.

- **`ColorTokens`**: `background, surface, surfaceAlt, text, textMuted, border, primary, onPrimary, danger, onDanger, success, warning` — 12 roles. No `info` role; no separate `onSuccess`/`onWarning` (success/warning are only ever used as text/border, never a filled background needing a contrasting foreground).
- **Light** ("Limestone/Char/Tilework"): background `#F6F4EF`, surface `#FFFFFF`, surfaceAlt `#EAE6DC`, text `#1C231F`, textMuted `#5B6459`, border `#D8D2C4`, primary `#0B5E52`, onPrimary `#FFFFFF`, danger `#B3261E`, onDanger `#FFFFFF`, success `#3F7D45`, warning `#A45908`.
- **Dark**: background `#121815`, surface `#1B221D`, surfaceAlt `#242C26`, text `#EDEAE1`, textMuted `#A7AD9E`, border `#374039`, primary `#4FBDAE`, onPrimary `#052A25`, danger `#E06456`, onDanger `#2A0805`, success `#6FB876`, warning `#E8973B`.
- **Spacing** (4pt): `xs:4, sm:8, md:12, lg:16, xl:24, xxl:32`.
- **Radii**: `sm:8, md:12, lg:16, pill:999`.
- **`MIN_TOUCH_TARGET = 48`**, enforced via `minHeight` in `Button`, `Card`, `Chip`, `Checkbox`, `TextField`.
- **Typography** (named variants): `title {28/34/700}, heading {20/26/600}, body {16/22/400}, label {14/20/600}, caption {13/18/500}`. `caption` is deliberately 500-weight for small-size Indic-script legibility.
- **Elevation policy**: one `elevatedShadow` constant (`shadowOpacity 0.12, shadowRadius 8, elevation 3`), opt-in via `Card`'s `elevated` prop. Documented policy: flat by default; elevation reserved for genuinely time-pressured/decision-now surfaces. Followed with zero exceptions across every screen audited.
- **WCAG tooling**: `relativeLuminance`/`contrastRatio` back `tokens.spec.ts`, which asserts every text/background pairing meets 4.5:1 AA. Real CI guardrail — any new palette must keep passing it or the spec must change deliberately.
- A `tokens.draft.ts` is referenced in `Screen.tsx`'s doc comment as a staging ground for draft redesign tokens, but does not currently exist in `src/theme/` — either already removed or never committed.

### `src/theme/ThemeProvider.tsx`

Minimal: a Context exposing `{ scheme: 'light'|'dark', colors: ColorTokens }`, derived from
`useSettings().themeMode` (`system|light|dark`, zustand+AsyncStorage) combined with OS
`useColorScheme()`. Typography/spacing/radii are static constants imported directly from
`tokens.ts`, not threaded through context — color is the only dynamic theme axis.

---

## 7. Fonts

**No custom font is loaded anywhere.** No `expo-font` dependency, no `useFonts` call, no
`fontFamily` override anywhere in `.tsx`/`.ts`, no font plugin/asset declaration in `app.json`.
Every `Text` renders in the OS default (San Francisco / Roboto) at `typography` sizes/weights. A
branded typeface starts from zero plumbing — the one injection point is `src/components/Text.tsx`'s
`style={[typography[variant], ...]}`.

---

## 8. Shared component library (`src/components/`)

Exported from `index.ts`: `Button, Card, Checkbox, Chip, Countdown, LeagueUpModal, Screen,
EmptyState/ErrorState/LoadingState, Text, TrackingMap, TextField`.

| Component | File | Summary |
|---|---|---|
| `Button` | `Button.tsx` | `primary/secondary/danger`, loading spinner, disabled/opacity, 48dp min height, full a11y props. Palette-driven. |
| `Card` | `Card.tsx` | Flat by default, optional `onPress` (becomes accessible button), optional `elevated` per policy. 48dp min height, `radii.lg`. |
| `Checkbox` | `Checkbox.tsx` | On/off toggle, 22×22, theme-driven. |
| `Chip` | `Chip.tsx` | Single-choice "radio" pill (`accessibilityRole="radio"`), pill-radius. |
| `Countdown` | `Countdown.tsx` | Ticking `m:ss` until an ISO timestamp, polite live region. |
| `Screen` | `Screen.tsx` | SafeAreaView + optional ScrollView; applies `background` + `spacing.lg`. The one layout primitive every screen is built on. |
| `EmptyState`/`ErrorState`/`LoadingState` | `StateView.tsx` | The three canonical non-happy-path states. **Used correctly almost everywhere.** |
| `Text` | `Text.tsx` | Typed wrapper: `variant` → `typography`, `color` → `ColorTokens`, auto `accessibilityRole="header"` for title/heading, caps font-scaling at 1.6×. |
| `TextField` | `TextField.tsx` | Labelled input, optional `prefix` (`+91`, `₹`), inline error-as-alert. |
| `TrackingMap` | `TrackingMap.tsx` | MapLibre/OSM live map with text+"open in Maps app" fallback when the native module is absent. No Google Maps billing exposure (D-021). |
| `LeagueUpModal` | `LeagueUpModal.tsx` | Global league-up celebration modal, zustand-queue-driven. |

**Missing from the shared library, hand-rolled per-screen instead** (extraction candidates):
- A star-rating component (`StarPicker`/`Stars` duplicated between `ReviewPrompt.tsx` and `RangerReviewsScreen.tsx`).
- A status-color badge/pill (`STATUS_COLOR` copy-pasted across 6 files).
- A progress-bar/ladder-rung component (hand-built identically in `LeagueScreen.tsx` and `ClientLeagueScreen.tsx`).
- A "selectable list row" (the address-picker in `NewRequestScreen.tsx`).

---

## 9. Icons

Only **`@expo/vector-icons` Ionicons** (`^15.0.2`) — no secondary icon set, no custom SVG component,
no app-owned icon font. Every usage is `<Ionicons name="literal-string" .../>` inline, with no
central icon-name map/enum:

- Tab bar: `'grid'`, `'list'`, `'briefcase'`, `'person'`, `'settings'`.
- `HomeScreen.tsx`: icon name is **server-supplied data** (`cat.icon as keyof typeof Ionicons.glyphMap`), cast without runtime validation — a typo or renamed icon server-side renders nothing, with no fallback.
- `RangerReviewsScreen.tsx` / `ReviewPrompt.tsx`: `'star'` / `'star-outline'`.
- `NewRequestScreen.tsx`: `'radio-button-on'` / `'radio-button-off'` / `'add-circle-outline'`.

A redesign swapping icon sets touches every call site individually unless centralized first.

---

## 10. Emoji usage

**None found anywhere** — not in any of the five locale files (`en/hi/kn/ta/te.ts`) nor inline in
any `.tsx`. The only non-ASCII decorative glyph in the whole `src/` tree is a plain **★** character
in `en.ts`'s `ratingWithCount: '★ {{rating}} ({{count}})'`, which is typographic, not emoji, and
consistent with the app's real `Ionicons` star-based rating UI. Nothing to strip; a clean baseline.

---

## 11. Summary of concrete, fixable issues

1. **Hardcoded hex color** — `src/features/legal/LegalScreens.tsx:14`, `borderColor: '#B45309'` in `PlaceholderBanner`. Should be a theme token.
2. **Two screens explicitly flagged "no visual treatment yet"** — `ranger/LeagueScreen.tsx`, `account/ClientLeagueScreen.tsx`. Expected to change shape, not just color, in the overhaul.
3. **Duplicated `STATUS_COLOR` maps** across 6 files — centralize into one lookup + a `StatusBadge`/`StatusPill` component.
4. **Duplicated star-rating UI** — extract `StarPicker`/`Stars` into one shared component.
5. **Inconsistent DOB entry** — 3-digit-field (`PersonalDetailsFields.tsx`) vs. free-text `YYYY-MM-DD` (`StudentProfileScreen.tsx`).
6. **One-off "selectable row" pattern** in `NewRequestScreen.tsx`'s address picker, parallel to but visually different from `Chip`.
7. **Icon names as untyped literal strings** everywhere, including one server-supplied path (`HomeScreen.tsx`) with no fallback.
8. **No custom font loaded** — redesign starts from zero font-loading plumbing.
9. **No dummy/dead buttons found** anywhere — every `onPress` is real. The closest things to incomplete are documented sandbox-only payment paths (`wallet.razorpayPending`, boost-listing payment), a known pending-integration gap, not a UI defect.
10. **`AccountScreen.tsx` is an unstructured stack of ~15 buttons/cards** — the strongest single candidate for an actual information-architecture rework (grouped sections, icon-led rows), not just a palette swap.
