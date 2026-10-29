# UI redesign from design images — page tracker

Branch: `ui/redesign-from-images`. One row per design image received. Commit hash: see
`git log --oneline -- <files>` for the page (each page is one commit,
`ui(<page>): rebuild from design image`).

| Page | Files | Status |
|---|---|---|
| Sign-in / landing (`PhoneScreen`) | `features/auth/PhoneScreen.tsx`, `components/Button.tsx`, `components/TextField.tsx`, `i18n/locales/*.ts` | Done — also set the app-wide foundation (see `FOUNDATION.md`) |
| OTP verification (`OtpScreen`) | `features/auth/OtpScreen.tsx`, `i18n/locales/*.ts` | Done — introduced the segmented `OtpBoxes` pattern (see `FOUNDATION.md`) |
| Consent (`ConsentScreen`) | `features/auth/ConsentScreen.tsx`, `i18n/locales/*.ts` | Done — introduced the `InfoRow` card pattern (see `FOUNDATION.md`) |
| Onboarding step 1 — Profile (`OnboardingScreen`) | `features/onboarding/OnboardingScreen.tsx`, `features/account/PersonalDetailsFields.tsx`, `packages/shared/src/api-schemas.ts`, `apps/api/src/users/users.service.ts`, `i18n/locales/*.ts` | Done — see D-111 in `docs/DECISIONS.md` for the confirmed scope decisions. |
| Onboarding step 2 — Address (`OnboardingScreen`) | `features/onboarding/OnboardingScreen.tsx`, `features/account/AddressesScreens.tsx`, `features/account/useAddressLocation.ts` (new), `api/endpoints.ts`, `i18n/locales/*.ts` | Done — real functionality, not a reskin (explicit instruction). See D-112 in `docs/DECISIONS.md`. Also added "Edit address" (was missing on mobile even though the backend already supported it) and onboarding now creates a real default address used everywhere else. |
| Onboarding step 3 — Preferences (`OnboardingScreen`) | `features/onboarding/OnboardingScreen.tsx`, `store/settings.ts`, `notifications/push.ts`, `features/settings/SettingsScreen.tsx`, `i18n/locales/*.ts` | Done — the last onboarding step. Fixed a real bug along the way: push notifications were being auto-requested at sign-in regardless of any toggle; now, like location, the OS prompt only fires when the person explicitly switches the preference on. See D-113 in `docs/DECISIONS.md`. Preferred service categories use the real catalog (`useCategories()`), kept device-local since no feature uses them yet. |

## Not implemented, needs a decision

- **Pre-auth Terms of Service / Privacy Policy links** (sign-in page): the design shows them as
  tappable links, but `legal/index` and `legal/[doc]` are currently gated to signed-in users only
  (`app/_layout.tsx`). Showing them pre-auth needs a routing-guard change, which is out of scope
  for a UI-only pass — flag if you want that guard opened up.
- **Location Access / Notifications pre-consent checkboxes** (consent page): the design shows two
  extra checkboxes ("I allow Haggler to access my location…", "…to send me notifications…"), but
  the app has no consent purpose or opt-in flow backing them today — location and notification
  permissions are requested natively by the OS at the point of use (starting a tracked job;
  toggling push in Settings), not collected as upfront consent. Shipping checkboxes that don't
  gate anything would be a dead control, so the consent page shows these as informational rows
  only (no checkbox, no chevron). If you want real pre-consent for these, that's a product/backend
  decision (new consent purposes), not a UI change.
- **Merging the Terms + Privacy checkboxes into one** (consent page): the design shows a single
  combined checkbox ("I have read and agree to the Terms of Service and Privacy Policy."), but
  `ConsentScreen.tsx` explicitly keeps them as two separate DPDP consents by design (see the
  file's own comment and `docs/COMPLIANCE.md`). Merging them would be a compliance-relevant
  change, not a visual one, so they stay as two checkboxes, styled close together.

- **Role picker at onboarding** (profile step): the design shows a Customer/Ranger picker as part
  of step 1. Confirmed with the product owner: omitted. Role stays a post-onboarding, self-serve
  action from the Account screen ("Become a Ranger" etc.), unchanged. See D-111.
- **Profile photo upload** (profile step): the design shows an "Add Photo" control. No upload
  endpoint exists anywhere in the codebase today (`photoUrl` is read-only on the client). Confirmed
  with the product owner: rendered as a visible, clearly-labeled "coming soon" control rather than
  faked. Building this for real needs a storage/upload endpoint — a backend decision, not a UI one.
- **Landmark field** (address step): the design shows a "Landmark (optional)" field with no
  backing column in the Address model. Confirmed with the product owner: omitted rather than
  adding a migration for one field on one screen — `addresses.line2` ("Area / landmark (optional)")
  already covers this informally everywhere else addresses are entered. See D-112.
- **Preferred service categories** (preferences step): collected and stored device-local only
  (`useSettings().preferredCategorySlugs`) — confirmed with the product owner, since no feature
  reads this yet. If a real use for it appears later, it would need a new user-record field and a
  migration to sync it server-side (today it stays on the device that set it). See D-113.

## Assets needed

- None yet. Page 1 (sign-in) avoided needing an illustration asset by using an icon mark instead of
  the design image's character illustration (see `FOUNDATION.md`).
