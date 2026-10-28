# 06 — Features by Role

> Source: `apps/mobile/src/app/` (43 route files — the Expo Router navigation tree, read via
> `find`), `apps/mobile/src/app/_layout.tsx`'s `Navigator()` function (the actual guard logic
> deciding which screens are reachable when), `apps/admin/src/app/` (7 pages), `docs/DESIGN_SYSTEM.md`
> (read in full), `apps/api/src/reputation/league-tier.ts` and `client-league-tier.ts` (read in
> full).

## Navigation structure (mobile)

`app/_layout.tsx`'s `Navigator()` gates four mutually exclusive worlds by session state, in this
order: **signed out** → `(auth)` only (phone/OTP screens); **signed in, missing a legal consent**
→ `consent` only; **signed in, profile incomplete** → `onboarding` only (mandatory first-sign-in
setup); **signed in and ready** → the full app, `(tabs)` plus every other route below.
`Stack.Protected` makes every other route genuinely unreachable in each state, even by deep link
— not just hidden from a nav menu.

The 5 bottom tabs (`(tabs)/_layout.tsx`): **Home** (`index.tsx`), **Account**, **Activity**,
**Settings**, **Work**.

## Customer

| Screen | File | What it does |
|---|---|---|
| Home | `(tabs)/index.tsx` | Post a new request; category browse; personalized greeting ("Hi {name}, what do you need help with?", D-104) |
| New request | `request/new.tsx` | Category, description, photos, address, urgency |
| Request/job status | `request/[id].tsx`, `job/[id].tsx` | Live status, the quote-accept/reject UI, live Ranger tracking map, chat entry point |
| Chat | `chat/[jobId].tsx` | Messaging with the matched Ranger |
| Browse Contract jobs | `contracts/index.tsx`, `contracts/[id].tsx` | Browse/apply as a potential future Ranger-side poster is N/A here — Customers browsing Contracts as a feature exists in the route tree but Contract **posting** is Employer-only; redesigned this session (D-105) to match the rest of the app's visual language |
| Browse Campus jobs | `campus/index.tsx`, `campus/[id].tsx` | Same pattern for Campus |
| Client League | `client-league.tsx` | This account's client-league tier and ladder (see below) |
| Haggler Plus | `wallet.tsx` | Subscribe to Plus, see active membership, purchase/payment history. **Token purchase UI removed this session (D-106)** — see `01-overview-and-status.md` |
| Addresses | `addresses.tsx`, `address-new.tsx` | Saved addresses |
| Blocked users | `blocked-users.tsx` | Manage the block list |
| Emergency contacts | `contacts.tsx` | Trusted-contact management (used by the safety "share my trip" feature) |
| Account | `(tabs)/account.tsx` | Profile summary, role badges (tag-style since D-108), entry points to every account-adjacent screen, "Delete my account" |
| Delete account | `delete-account.tsx` | Requests the 48-hour cancellable deletion (D-108) |
| Settings | `(tabs)/settings.tsx` | Theme, language, push-notification toggle, clear cache (redesigned this session, D-107 — "Server status" diagnostics panel removed) |
| Activity | `(tabs)/activity.tsx` | Past job/request history |
| Legal | `legal/index.tsx`, `legal/[doc].tsx` | ToS/Privacy/Refund policy text |
| Ranger reviews (reading) | `ranger-reviews/[id].tsx` | A specific Ranger's review history |

## Ranger (`WORKER` role — the word "worker" is never shown in-app)

| Screen | File | What it does |
|---|---|---|
| Work | `(tabs)/work.tsx` | Go online/offline, see incoming broadcasts, the active-job surface; personalized greeting (D-104); refreshes KYC tier on focus so an admin approval reflects without a manual pull (fixed this session) |
| Ranger verification | `ranger.tsx` | KYC tier progress/entry point |
| KYC flow | `kyc/[tier].tsx` | Tier 1/2/3 submission; tier-2's category picker was moved into this screen this session (previously confusingly lived on a separate screen) |
| Earnings | `earnings.tsx` | Worker wallet balance, dues, settlement |
| League | `league.tsx` | This account's Ranger-league tier and ladder |
| Browse Contract jobs (apply) | `contracts/index.tsx`, `contracts/[id].tsx` | Apply to Employer-posted Contract listings |
| My contract applications | `contracts/my-applications.tsx` | Track application status |
| Chat / job screens | shared with Customer above | Same screens, Ranger-side actions (en-route, arrive, quote, start, complete, pause-for-parts) |

## Employer

| Screen | File | What it does |
|---|---|---|
| Employer profile | `employer/profile.tsx` | Business name (no document verification exists for plain Contracts — D-056 known gap) |
| Contract listings (manage) | `employer/listings/index.tsx`, `new.tsx`, `[id].tsx` | Post, edit, review applicants, hire |
| Campus listings (manage) | `employer/campus/index.tsx`, `new.tsx`, `[id].tsx` | Same for Campus, gated by `EmployerProfile.verified` (D-062) |

## Student

| Screen | File | What it does |
|---|---|---|
| Student profile | `student/profile.tsx` | Expanded this session (D-103): course, year of study, skills, availability, bio, portfolio — on top of the pre-existing DOB/institute fields. The DOB field was deliberately **kept** despite a user complaint, because `StudentProfile.dateOfBirthEnc` is a separate, immutable, self-declared field used only for the 18+ hard block — not the same DOB collected at general onboarding |
| Browse Campus jobs (apply) | `campus/index.tsx`, `campus/[id].tsx` | Apply to Employer-posted Campus listings |
| My campus applications | `campus/my-applications.tsx` | Track application status |

## Admin (`apps/admin`, separate Next.js app, separate JWT audience)

**Only 7 pages exist**, despite the admin **API** (`admin.controller.ts`, `05-api-and-realtime.md`)
exposing far more — SOS queue, disputes, incident reports, fraud review, runtime config, and
price-list management all have working endpoints with **no corresponding admin UI page found**.
This is a real gap, not a flag-gated feature: an admin can only act on these via direct API calls
today.

| Page | File | What it does |
|---|---|---|
| Login | `app/login/page.tsx` | Admin email+password sign-in |
| (root) | `app/page.tsx` | Redirects to `/kyc` |
| KYC queue | `app/(app)/kyc/page.tsx`, `[id]/page.tsx` | Review and decide KYC submissions |
| Employers | `app/(app)/employers/page.tsx` | Employer verification queue |
| Listings | `app/(app)/listings/page.tsx` | Contract/Campus listing moderation |
| Reviews | `app/(app)/reviews/page.tsx` | Review moderation (hide) |

**NOT BUILT in the admin UI** (API exists, no page): SOS alert resolution, dispute resolution,
incident-report resolution, fraud-review queue, runtime config editing, price-list editing. See
`10-compliance-and-gaps.md`.

## Design system (`docs/DESIGN_SYSTEM.md`, read in full)

- **Visual direction**: Limestone (warm stone)/Char (warm near-black) instead of white/near-black;
  Tilework (deep teal-indigo) as primary; Marigold as a *stamp*-style accent (verified badges,
  confirmed prices) — explicitly "never as a background wash" per the code comment (this
  constraint was respected this session: the new deletion-grace banner uses `danger`/`onDanger`,
  not `warning`, specifically to avoid a warning-colored background wash).
- **Typography**: Manrope (4 weights), loaded before first render (splash screen held until
  ready); falls back to the system font per-glyph for Hindi/Tamil/Kannada/Telugu automatically.
- **Tokens**: a 4pt spacing scale, defined radii, `MIN_TOUCH_TARGET` (48dp, Android/iOS
  accessibility guidance), motion durations (120/200/320ms) used only for real state changes
  (sheet/dialog entrance, toast, league-up celebration, skeleton pulse) — "nothing animates
  decoratively."
- **Light and dark mode**: both exist, every text/background color pair checked against WCAG AA
  (4.5:1) in an automated test (`tokens.spec.ts`), so a future palette change that hurts
  readability fails CI.
- **Component library** (`src/components/index.ts`, the only import surface — no one-off
  `StyleSheet` screens): `Button`, `Card`, `Checkbox`, `Chip`, `Countdown`, `Screen`,
  `EmptyState`/`ErrorState`/`LoadingState`, `Text`, `TextField`, `TrackingMap`, `LeagueUpModal`,
  `Avatar`, `Badge`, `StatusPill`, `LeagueBadge`, `PriceTag`, `ListRow`, `Sheet`, `Dialog`,
  `ToastHost`, `Skeleton`. No emoji usage (project-wide stated rule).
- **States**: every data-driven screen handles loading/error/empty consistently — this session's
  work specifically fixed `ErrorState` always showing a generic "connection" message regardless of
  the real cause (now shows the actual error — forbidden, not-found, etc. — correctly), propagated
  across 23 screens.

## Leagues

Two independent gamified ladders, both "checked in order, first match wins, ends in an all-zero
floor tier so everyone has a league." Both explicitly documented in the code as **placeholder
thresholds** — "not a promise about how many jobs a real Ranger needs."

### Ranger league (`league-tier.ts`, 9 tiers, ascending)
WOOD (0 jobs) → STONE (1) → COPPER (5) → BRONZE (10) → SILVER (20) → GOLD (40) → PLATINUM (80) →
DIAMOND (150) → LEGENDARY (300). Each tier above STONE also requires a minimum **review count**
(so one lucky 5-star can't skip the ladder), a minimum **average rating** (3.5 at COPPER rising to
4.9 at LEGENDARY), and a **maximum cancellation rate** (25% at COPPER tightening to 2% at
LEGENDARY). A `maxDisputeRate` field exists on every tier but is permanently non-binding (`1`,
i.e. 100%) — the code comment states plainly this is "forward compatibility only": no code path
currently sets `JobStatus.DISPUTED` in a way that increments `WorkerStats.jobsDisputed`, so there
is nothing real for it to gate on yet.

### Client league (`client-league-tier.ts`, 9 tiers, ascending)
NEWCOMER (0 bookings) → REGULAR (1) → PREFERRED (2) → TRUSTED (3) → LOYAL (6) → ELITE (12) →
CHAMPION (25) → PATRON (50) → LEGEND (100). Deliberately **no dispute-rate factor** (the code
comment says the brief named three client-side inputs, not four) — just bookings, the rating
*Rangers* leave for the customer, and a cancellation ceiling.

### Anti-farming
- **Rating-count floor** on both ladders (above) prevents a single good review from being enough.
- **Cancellation-rate ceiling** tightens as the tier rises on both ladders.
- A booking only counts toward a **client's** league if the matched Ranger was genuinely
  KYC-tier-2+ **at that moment** (`lifecycle.service.ts:489-515`) — explicitly described in the
  code as "belt-and-braces" against a second account the same person controls farming client-league
  progress without a real verified Ranger involved.
- A separate, flag-driven **fraud review queue** (never auto-blocking — see `02` and `07`) flags a
  Ranger's league promotion for admin review if it was reached via suspiciously fast job velocity,
  an unusually repeat-heavy customer pairing, or mostly very-low-value jobs.

### League-up bonus — a reconciliation point
Reaching a new tier pays a **one-time token bonus** to the account's wallet
(`reputation.service.ts:39,307-309,342-344`, `WorkerWalletService.grantLeagueBonus`/the
equivalent customer-side call) — paid against the account's all-time highest league reached, so
dropping and re-reaching a tier never pays twice. **This still pays in tokens**, the same currency
whose purchase/top-up UI was removed from the Customer Wallet screen this session (D-106). The
tokens are still credited to the account; whether there is still any UI surface to see or spend
that balance after the wallet redesign was **not independently re-verified in this pass** — flagged
here as worth checking directly in the running app before assuming the bonus is still meaningfully
visible to the person who earned it.
