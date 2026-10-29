# UI port report — teammate redesign from `Haggler-main_2.zip`

Branch: `ui/teammate-redesign` (pushed to origin, **not merged to `main`**).

## Base commit

`6dd04dd` — "D-101: email OTP fallback - free, no registration, opt-in channel". Found by
byte-for-byte comparison, not inference: every non-UI logic directory (`apps/api/src`,
`packages/shared/src`, `apps/api/prisma/migrations`, `apps/mobile/src/{api,store,auth,lib,
realtime,location,notifications}`) has **0 differing files** against this commit's tree. No other
candidate needed scoring — an exact match on hundreds of files across two independent languages
(TypeScript backend + mobile) is conclusive. Independently confirmed: the zip's `docs/DECISIONS.md`
ends at D-101, and `6dd04dd` is exactly the commit before `f4ba12a` ("D-102: ..."), the first commit
of this session's work. See `docs/ui-port/PLAN.md` for the full table. No fallback path was needed.

## File-by-file table

| File | Class | Source of change | Notes |
| --- | --- | --- | --- |
| `apps/mobile/src/app/(tabs)/_layout.tsx` | UI-ONLY | zip (merged onto HEAD, no HEAD-side logic changed) | Outline/filled icon swap, pill highlight behind active tab, taller bar. Had to retype `TabIcon`'s `color` prop as `ComponentProps<typeof Ionicons>['color']` instead of `string` — React Navigation's `tabBarIcon` passes a `ColorValue` (can include `OpaqueColorValue`), which `string` doesn't accept under this repo's strict TS config. Purely a type annotation; no behaviour change. |
| `apps/mobile/src/features/home/HomeScreen.tsx` | UI-ONLY | merged (zip presentation + HEAD's D-104 name personalization + D-102's `ErrorState(error)`) | Flat divided rows → `Card` tile grid. |
| `apps/mobile/src/features/activity/ActivityScreen.tsx` | UI-ONLY | merged (zip presentation + HEAD's D-102 `ErrorState(error)`) | Status dot + badge instead of plain status text. |
| `apps/mobile/src/features/settings/SettingsScreen.tsx` | UI-ONLY | merged, HEAD's content wins | Zip's "Server status" section does not exist in HEAD (D-107 replaced it with a real push-notifications toggle + clear-cache action) — not ported back. HEAD's two sections restyled with the zip's `SectionHeading`+`Card` pattern instead. |
| `apps/mobile/src/features/work/WorkScreen.tsx` | UI-ONLY | merged, HEAD's logic wins | Zip's full card restructuring applied around HEAD's D-103 focus-triggered `refreshMe()` and D-104 personalized title. Highest-stakes file in this port (accept/decline/quote real money) — see Manual-risk review below. |
| `apps/mobile/src/features/account/AccountScreen.tsx` | UI-ONLY | merged, HEAD's content wins | Zip's "Download my data" row does not exist in HEAD (removed D-108) — not ported back. HEAD's wallet label "Haggler Plus"/`star-outline` (D-106) kept over the zip's stale "wallet"/`wallet-outline`. Zip's `Badge`-for-roles already matched D-108's own `Badge`-for-roles — no reconciliation needed, just layout. |

**Everything else** (`theme/tokens.ts`, `ThemeProvider.tsx`, every file under `components/`, all
assets/fonts, `apps/admin`, `docs/DESIGN_SYSTEM.md` as it stood at the base commit) is identical
between the zip and the base commit — the teammate did not touch them, so this port doesn't either.
No MIXED files, no NON-UI files in scope, no new screens/routes/components/assets introduced, no
new npm dependency.

## Conflicts and how each was resolved

All 6 changed files are in the CONFLICT set (also touched by this session's D-102-D-108 work since
the base commit). Resolution in every case: **current HEAD's logic/content wins, the zip's
presentation is reapplied around it.** Specifics are in the table above and in
`docs/ui-port/PLAN.md`'s "Conflict set" section — repeated here only where a real decision was
made rather than a mechanical merge:

- **Settings**: a whole section (Server status) exists in the zip but not in HEAD. Rule 3 (current
  features must be kept) governs — HEAD's replacement content (Notifications, Storage) was restyled
  with the zip's own section pattern rather than resurrecting the removed feature.
- **Account**: same situation in reverse for the "Download my data" row — it was deliberately
  removed from HEAD in D-108 and stays removed.
- **Account roles**: the zip's `Badge` tone logic (`role === 'WORKER' ? 'accent' : 'neutral'`) was
  adopted over HEAD's prior "always accent" — a presentation-only judgment call (Badge tone carries
  no behaviour), documented here per the ambiguity rule rather than treated as something to ask
  about, since it's neither irreversible nor a feature/flow change.
- **Work screen's dropped testID**: the zip's diff for the tier<2 branch drops
  `testID="needs-verification"` and the warning text color entirely. Rule 5 overrides the zip here —
  the testID and `color="warning"` were kept (tests rely on the testID; the color is a real
  accessibility signal, not decoration).
- **Activity screen's reused i18n key**: the zip's role-toggle caption passes
  `t('activity.title')` a second time (same key as the screen's own title, immediately above). This
  reads slightly redundant ("Activity" as a caption under "Activity" as a heading) but is not a
  logic issue and no dedicated key exists for "switch view" — kept as authored per "reuse existing
  keys where text is unchanged," flagged here rather than silently inventing a new key.

## New interactive elements

**None.** Every `testID`, handler and navigation target across all 6 files is identical to its
base-commit counterpart — this redesign is a restyle, not a feature add. Nothing needed new
wiring, and nothing is listed under "Needs backend decision" because nothing new was proposed.

## Items deferred / not ported

- The zip's "Server status" section (`SettingsScreen`) — superseded by D-107, not re-added (rule 3).
- The zip's "Download my data" row (`AccountScreen`) — removed in D-108, not re-added (rule 3).
- The zip's "wallet"/`wallet-outline` label on the wallet row — superseded by D-106's "Haggler
  Plus"/`star-outline`, not reverted.

Nothing else from the zip was intentionally left out — the diff between the zip and its base
commit covers exactly the 6 files listed above, with no additional hunks.

## New dependencies

None. `npx expo install --check` was not needed — no new import resolves to a package outside
what's already in `apps/mobile/package.json` (`@expo/vector-icons`, already used everywhere;
`react-native`'s own `StyleSheet`/`View`).

## Behaviour-preservation table

Handlers, queries and mutations per screen, before (HEAD pre-port) vs after (this branch) — every
row is identical; this is the evidence for "zero behaviour change":

| Screen | Queries/mutations | Handlers | Before → After |
| --- | --- | --- | --- |
| Tab bar | `useSession` (isRanger) | n/a (navigation chrome) | Unchanged |
| Home | `useCategories()` | `router.push('/request/new', {category})` per tile | Unchanged |
| Activity | `useJobs(role)` | role toggle (`setRole`), `router.push('/job/[id]')` per card | Unchanged |
| Settings | `useSettings()` (theme/language/push), `useQueryClient().clear()` | `setThemeMode`, `setLanguage`, `togglePush` (register/unregister push token), `clearCache` | Unchanged |
| Work | `usePresence`, `useIncoming`, `useJobs('WORKER')`, `useFocusEffect(refreshMe)` | `toggle` (go online/offline), `accept`, `quote`, `decline`, filter chips | Unchanged |
| Account | `useSession` | `becomeRanger`/`becomeEmployer`/`becomeStudent`, `signOut`, navigation `go(path)` per row | Unchanged |

## Manual-risk review: money, safety, codes

- **`WorkScreen.tsx`** (accept/decline/quote a real job, online/offline presence): read the full
  ported file end-to-end against the pre-port version. All five async handlers
  (`toggle`/`accept`/`quote`/`decline`, plus the `tier < 2` KYC gate) are byte-identical in logic —
  same query invalidation order, same error handling, same early returns. Only JSX/StyleSheet
  changed. The `IncomingCard`'s countdown (`Countdown` component, real deadline logic) and its
  `TextField`/quote-validation (`parseRupeesToPaise`, min 100 paise) are unchanged.
- No other screen in this port touches a quote, arrival code, SOS, completion flow, or wallet
  balance — Job detail, chat, SOS, KYC, and the wallet/Haggler Plus screen itself were **not**
  touched by the teammate's redesign (confirmed by the 6-file diff above) and so are out of scope
  for this port entirely.

## Accessibility

- All `Pressable`/`Card`-with-`onPress` elements already route through the design system's `Card`
  and `Button`, which set `accessibilityRole="button"` and a `MIN_TOUCH_TARGET` (48dp) minimum —
  unchanged by this port, since no new interactive primitive was introduced.
- `needs-verification` testID and its `color="warning"` were explicitly kept on `WorkScreen` (see
  Conflicts section) specifically because losing the color would have been an accessibility
  regression (the only non-icon signal that this message is a warning).
- No new color was introduced, so no new WCAG contrast pairs exist to check; `tokens.spec.ts`'s
  existing contrast suite is unaffected and still passes.
- No new animation was introduced (no `react-native-reanimated` usage added) — nothing to check
  against reduced-motion.

## Performance

No new list virtualization concerns (`ScrollView`-based screens, same as before — the port didn't
change list rendering strategy). No new images or icon assets — all icons are `@expo/vector-icons`
glyphs, same as the pre-port code. Bundle impact: zero (no new dependency).

## Test / typecheck / lint results

| Check | Before this branch | After this branch |
| --- | --- | --- |
| Mobile `npx tsc --noEmit` | clean | clean |
| Mobile `npx jest` | 544/544 | 544/544 (3 `work.spec.tsx` assertions rewritten for markup-only changes — see below; no test deleted) |
| API `npx jest --config jest.unit.config.js` | 228/228 | 228/228 (untouched by this UI-only port) |
| i18n key-parity (`src/i18n/i18n.spec.ts`) | green | green — **0 new i18n keys added**, every string ported reuses an existing key |
| `eslint` on touched files | n/a | clean |
| `prettier --write` on touched files only | n/a | applied, no remaining diffs |

**The 3 `work.spec.tsx` changes**, all markup-only (same behaviour under test):

1. `'840 m away · Chennai 600042'` (one joined string) → two separate `getByText` calls for
   `'840 m away'` and `'Chennai 600042'`, because the redesign renders them as two `Text` nodes
   (an icon-prefixed distance row, then a separate address line) instead of one.
2. Same split for the `'3.5 km away · ...'` long-distance test.
3. The Kannada translation check for "offline" moved from `findByText` (which became ambiguous —
   the redesign shows the word once in the presence heading and again in a small status badge next
   to it, by design) to `findByTestId('presence-label')` + `toHaveTextContent`, which targets the
   specific element the test actually cares about.

## Screens not visually verified

No device or emulator was available in this environment for any part of this session. Every claim
above about layout is from reading the code and the diffs, and from the automated test suite (which
exercises these components under React Native Testing Library, not a real renderer) — **please
visually check all 6 ported screens on a device before considering this design finished**:
`(tabs)` bar (all 5 tabs, focused/unfocused states), `HomeScreen` (grid wrapping on a narrow
screen, skeleton state), `ActivityScreen` (status badge colors for every job status, long
descriptions), `SettingsScreen` (both new sections next to Appearance/Language), `WorkScreen`
(every card: verification gate, presence, active job, each `IncomingCard` variant — "Other"
category with the quote form vs a normal fixed-price request), `AccountScreen` (profile card with
1-4 role badges, all three promo-card variants, every list section).

## Commits on this branch

```
30b3482 ui(plan): record base commit evidence and port plan for teammate redesign
98ad37e ui(tabs): port redesigned tab bar from teammate snapshot
623fa27 ui(home): port redesigned category grid from teammate snapshot
355438f ui(activity): port redesigned job list from teammate snapshot
6e7ad7e ui(settings): port redesigned settings layout, keep D-107 content
b011e20 ui(work): port redesigned Ranger screen, keep D-103/D-104 logic
bc38df9 ui(account): port redesigned account screen, keep D-106/D-108 content
cc114b5 ui(docs): document D-109 UI-port conventions and decision entry
```
