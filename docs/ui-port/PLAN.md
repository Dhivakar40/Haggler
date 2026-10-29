# UI port plan — teammate redesign from `Haggler-main_2.zip`

## Base commit

**`6dd04dd` — "D-101: email OTP fallback - free, no registration, opt-in channel"**

Determined by hashing every file the teammate should not have touched (logic, not
presentation) and diffing them byte-for-byte against each candidate commit's tree:

| Directory compared                                  | Differing files vs `6dd04dd` |
| ----------------------------------------------------- | ----------------------------: |
| `apps/api/src`                                        | 0                              |
| `packages/shared/src`                                 | 0                              |
| `apps/api/prisma/migrations`                          | 0                              |
| `apps/mobile/src/api`                                 | 0                              |
| `apps/mobile/src/store`                               | 0                              |
| `apps/mobile/src/auth`                                | 0                              |
| `apps/mobile/src/lib`                                 | 0                              |
| `apps/mobile/src/realtime`                            | 0                              |
| `apps/mobile/src/location`                            | 0                              |
| `apps/mobile/src/notifications`                       | 0                              |

Every non-UI file is an exact byte-for-byte match — the strongest possible signal, so no
further candidates were scored. Sanity checks both independently point at the same commit:

- `docs/DECISIONS.md` in the zip ends at **D-101**; `git log --oneline --all | grep D-101`
  resolves to this exact commit, and the commit immediately after it (`f4ba12a`) is
  "D-102: fix email-OTP validation UX, ..." — i.e. the first commit of this session's
  work, confirming `6dd04dd` is the last commit *before* any of this session's changes.
- The zip's folder name (`Haggler-main`) and lack of `.git` matches a GitHub "Download
  ZIP" snapshot, as the task predicted.

No fallback was needed — this is an exact-match base, not an inferred one.

## Scope of the teammate's redesign

Comparing the zip against the base commit (restricted to `apps/mobile`, `apps/admin`,
`docs/DESIGN_SYSTEM.md`, assets) turned up **6 changed files, all UI-only**:

| File                                                  | Class    |
| ------------------------------------------------------ | -------- |
| `apps/mobile/src/app/(tabs)/_layout.tsx`               | UI-ONLY  |
| `apps/mobile/src/features/home/HomeScreen.tsx`         | UI-ONLY  |
| `apps/mobile/src/features/activity/ActivityScreen.tsx` | UI-ONLY  |
| `apps/mobile/src/features/settings/SettingsScreen.tsx` | UI-ONLY  |
| `apps/mobile/src/features/work/WorkScreen.tsx`         | UI-ONLY  |
| `apps/mobile/src/features/account/AccountScreen.tsx`   | UI-ONLY  |

No other file in `apps/mobile`, `apps/admin`, assets, fonts, `theme/tokens.ts`,
`ThemeProvider.tsx`, or `components/*` differs from the base commit at all. Concretely:
**the teammate did not touch the design foundation or the shared component kit** — no
new colours, no new spacing/radius tokens, no new or restyled `Button`/`Card`/`Chip`/
etc., no new fonts or assets, no new npm dependencies. The redesign is entirely
screen-level composition built from the *existing* component kit (`Card`, `Badge`,
`Chip`, `Button`, `ListRow`, `Text`) plus inline `@expo/vector-icons` icons and
`StyleSheet` — e.g. wrapping groups of `ListRow`s in `Card`s with an icon-led section
heading above them, giving list/grid items icon "chips" (a tinted square with a
centered icon), turning flat text rows into bordered/radius'd tiles, and adding status
dots/badges. This is low-risk to port: Phase B.1 (design foundation) and B.2 (component
kit) have nothing to do, and no new dependency check is needed.

**No MIXED files, no new screens/routes/components/assets/dependencies introduced by
the zip, no admin UI changes.** `apps/admin` and `docs/DESIGN_SYSTEM.md` are byte-for-byte
identical to the base commit.

## Conflict set (changed on both sides since the base commit)

All 6 files were also touched by this session's post-D-101 work (D-102–D-108), so all 6
are in the CONFLICT set. Current HEAD's logic wins in every case; the teammate's
presentation is re-applied around it. Specifics:

- **`(tabs)/_layout.tsx`**: no HEAD-side logic changes since base — a clean apply.
- **`HomeScreen.tsx`**: HEAD added the personalized title (`home.titleNamed`, D-104).
  Keep HEAD's name-lookup logic; apply the zip's tile-card grid styling around it.
- **`ActivityScreen.tsx`**: no HEAD-side logic changes since base — a clean apply.
- **`SettingsScreen.tsx`**: HEAD replaced the entire "Server status" section with a
  functional push-notifications toggle and a clear-cache action, and removed
  `useServerStatus` (D-107). The zip's Server-status section does not exist in HEAD and
  will NOT be ported (HEAD's feature set wins per rule 3) — HEAD's Notifications and
  Storage sections are restyled using the zip's `SectionHeading` + `Card` pattern
  instead, so nothing about the settings screen looks left behind next to Appearance/
  Language.
- **`WorkScreen.tsx`**: HEAD added a focus-triggered `refreshMe()` (D-103, so KYC tier
  updates are picked up without a relaunch) and the personalized title (`work.titleNamed`,
  D-104). Keep both; apply the zip's card restructuring (icon-led headers, price/deadline
  panels, attachment rows) around them. This is the service's highest-stakes screen
  (accept/decline/quote a real job) — logic is being preserved verbatim, see REPORT.md's
  behaviour-preservation table.
- **`AccountScreen.tsx`**: HEAD removed the "Download my data" row entirely (D-108) and
  already renders roles as `Badge` tags rather than comma-separated text (D-108) — the
  zip independently arrived at the same `Badge`-for-roles idea, so that part needs no
  reconciliation, just the zip's exact spacing/layout. HEAD also renamed the wallet row
  to "Haggler Plus" with a `star-outline` icon (D-106); the zip still calls it "wallet"
  with `wallet-outline` — HEAD's icon/label wins (it reflects a real product change the
  zip never saw), the zip's `ListRow`-group-under-`SectionHeading` card structure is kept
  around it. The account-deletion top banner (D-108) lives in `_layout.tsx`, not this
  screen, and is unaffected either way.

## New interactive elements introduced by the zip

None. Every `testID`, every handler, every navigation target in the 6 changed files is
identical to its base-commit counterpart — this is a restyle, not a feature add. Nothing
needs new wiring, new backend capability, or a "Needs backend decision" entry.

## Plan for Phase B

Work through the 6 files in this order, each its own commit:

1. `ui(tabs): port redesigned tab bar from teammate snapshot`
2. `ui(home): port redesigned category grid from teammate snapshot`
3. `ui(activity): port redesigned job list from teammate snapshot`
4. `ui(settings): port redesigned settings layout, keep D-107 content`
5. `ui(work): port redesigned Ranger screen, keep D-103/D-104 logic`
6. `ui(account): port redesigned account screen, keep D-106/D-108 content`

Then: i18n check (expect no new keys needed — the zip reuses every existing key,
confirmed while reading each diff), `docs/DESIGN_SYSTEM.md` update, `docs/DECISIONS.md`
entry (next free number is **D-109**), and the full quality-gate pass in REPORT.md.

Proceeding to Phase B.
