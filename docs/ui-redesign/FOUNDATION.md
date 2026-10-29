# UI redesign from design images — foundation

Source: a set of AI-generated design images, sent one page at a time by the product owner,
starting with the sign-in / landing page. Rules governing this whole effort are in the task prompt
that started it (not duplicated here); this file records the concrete decisions the first page
made, which every later page reuses rather than reinvents. See `docs/DESIGN_SYSTEM.md`'s "D-110"
entry for the full rationale; this file is the quick-reference version for later pages.

## Tokens

No color, spacing, radius, typography or motion token changed. The existing "Phase UI" palette
(`theme/tokens.ts`) already matches the design images closely enough (a warm off-white background,
a deep teal primary) that introducing a second palette would just be churn. If a later image shows
a color genuinely outside what exists today, that'll be called out explicitly when it comes up —
not assumed.

## Component changes (apply everywhere automatically)

- `Button`: base shape is now a full pill (`radii.pill`, was `radii.md`). New optional props:
  `icon` (leading/trailing `@expo/vector-icons` glyph) and a `soft` variant (filled
  `colors.surfaceAlt`, no border) alongside the existing `primary` / `secondary` / `danger`.
- `TextField`: input box is now a pill (`radii.pill`, was `radii.md`). When `prefix` is set, a
  thin vertical divider now separates it from the typed value.

## Patterns for later pages

- **Hero/value-prop sections**: an icon mark in a `colors.primary` rounded square (not a cartoon
  illustration — those need a real asset, see below), app name, tagline, then a short list of
  icon + text value props (each icon in a small `colors.surfaceAlt` pill).
- **A "sheet" card below the hero**: a `colors.surface` block, pulled edge-to-edge with
  `marginHorizontal: -spacing.lg` to cancel `Screen`'s own horizontal padding, `radii.lg` corners,
  holding the page's actual form/content. Reuse this instead of a plain `Card` when a page's image
  shows a distinct "floating panel over a colored hero" layout.
- **Divider row** ("or" between two actions): two flex-1 1px lines in `colors.border` with a
  caption-styled label between them. Inline `StyleSheet`, not a new shared component (one visual
  use so far — promote to `components/` if a third page needs it).

## Illustrations / photos

Images may show hand-drawn characters, photos or logos. These are **never** cropped from the
source image or faked as a broken image path. Per page, the choice is: (a) replace with an
existing icon/vector treatment if the shape is simple enough, or (b) list the exact asset needed
(name, size, format) under "Assets to supply" in that page's report and leave a clearly-named,
neutral placeholder slot. Page 1 (sign-in) took option (a) — see `docs/DESIGN_SYSTEM.md` D-110.

## Segmented code input (`OtpBoxes`, `features/auth/OtpScreen.tsx`)

For a "6 individual boxes" code-entry design: don't split state across 6 inputs (that breaks
paste, SMS autofill, and the single `otp-input` testID existing tests rely on). Instead, render
one real `TextInput` — transparent, absolutely positioned over the box row, catching all touches
and keystrokes — and 6 plain `View`s underneath that just mirror characters out of the same
`value` string, with the box at the current length highlighted in `colors.primary`. Reuse this
`OtpBoxes` pattern (currently local to `OtpScreen.tsx`; promote to `components/` if a second page
needs it) for any other segmented/PIN-style input a later image shows.

## `InfoRow` card (`features/auth/ConsentScreen.tsx`)

A `Card` wrapping an icon-in-circle + title/subtitle + optional trailing chevron, used for
"explain this, and let the person go read more" rows (e.g. a consent page's Terms/Privacy/
Location/Notifications rows). Differs from `ListRow` by being an individually-bordered,
`radii.lg` tile (the D-109 "flat list rows become Card tiles" pattern) rather than a
bottom-divided list item — use `InfoRow` when the image shows separate rounded cards, `ListRow`
when it shows a continuous list. `onPress` omitted renders a plain, non-interactive informational
card (no chevron) — the right choice for a row that has real content to show but no real
destination to tap into (see "Elements with no backing feature" below for when that applies).
Currently local to `ConsentScreen.tsx`; promote to `components/` if a second page needs it.

## Stepper (`features/onboarding/OnboardingScreen.tsx`)

A non-interactive 3-dot progress indicator (dot + connecting line + label per step), for a page
whose design shows a multi-step flow where only step 1 exists as a real screen so far. The dots
are never pressable — don't wire them to navigation until the later steps actually exist as
screens; a tappable step with nowhere to go is exactly the kind of dead control rule 3 rules out.
Once step 2 existed (the Address step, D-112), the dots gained a third state: done (filled +
checkmark, for a step already completed earlier in the same session), active, and pending — still
never tappable, just richer information.

## Multi-step mandatory flow in one screen, one `finish()` (`OnboardingScreen.tsx`)

When a design turns a single mandatory, one-time-API-call screen into a multi-step wizard, don't
call the API at the end of each step — check whether the *real* submit is one-time (here,
`completeOnboarding` 409s on a second call, and the root navigator leaves the route the instant
`profileComplete` flips true, so there's no "come back for step 2" moment). Instead hold every
step's fields in one component's state with a local `step` number, and call the API(s) exactly
once, from whichever action ends the wizard (a final "Continue" or any "Skip"/"later" affordance).
Treat a conflict from that one-time call as success, not an error — it means a previous attempt
already got through before something else (e.g. a second network call) failed, and retrying should
recover, not strand the person on an error screen forever.

## Reusing a hook across a redesigned screen and its untouched sibling (`useAddressLocation.ts`)

When a redesigned screen needs logic that already exists almost verbatim in a screen outside this
round's scope (here: onboarding's address step needed the exact GPS/reverse-geocode flow
`NewAddressScreen.tsx` already had), extract it to a shared hook instead of copy-pasting — then
refactor the untouched screen to use the hook too, so there's exactly one implementation and one
set of tests to trust. This is a UI-redesign-adjacent refactor (same behavior, same testIDs,
zero functional change to the untouched screen), not scope creep.

## Opt-in permission toggles (`OnboardingScreen.tsx`'s Preferences step, D-113)

When a design shows a toggle for an OS permission (notifications, location, camera, …), the
prompt must fire *only* from that toggle's own `onPress` — never from a `useEffect` that reacts to
a persisted "enabled" setting defaulting to `true`, which prompts automatically the moment that
effect first runs (e.g. at sign-in), with no toggle ever touched. Audit every existing
`request*PermissionsAsync` call site before assuming a new toggle is needed; this round found
location was already toggle-driven everywhere, and the only real bug was push notifications'
settings default. Share the register/request logic between every screen offering the same toggle
(`notifications/push.ts`'s `syncPushRegistration`) rather than duplicating it.

## Elements with no backing feature

The design images are AI-generated and occasionally show something the app doesn't do (an extra
login method, a tappable element with no real destination). Per task rule 3, these are never
shipped as dead controls. Page 1's two instances and how they were resolved are in D-110 — reuse
that reasoning (closest existing feature → omit → ask) for any later page's equivalent case.
