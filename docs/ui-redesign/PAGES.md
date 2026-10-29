# UI redesign from design images — page tracker

Branch: `ui/redesign-from-images`. One row per design image received. Commit hash: see
`git log --oneline -- <files>` for the page (each page is one commit,
`ui(<page>): rebuild from design image`).

| Page | Files | Status |
|---|---|---|
| Sign-in / landing (`PhoneScreen`) | `features/auth/PhoneScreen.tsx`, `components/Button.tsx`, `components/TextField.tsx`, `i18n/locales/*.ts` | Done — also set the app-wide foundation (see `FOUNDATION.md`) |
| OTP verification (`OtpScreen`) | `features/auth/OtpScreen.tsx`, `i18n/locales/*.ts` | Done — introduced the segmented `OtpBoxes` pattern (see `FOUNDATION.md`) |
| Consent (`ConsentScreen`) | `features/auth/ConsentScreen.tsx`, `i18n/locales/*.ts` | Done — introduced the `InfoRow` card pattern (see `FOUNDATION.md`) |

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

## Assets needed

- None yet. Page 1 (sign-in) avoided needing an illustration asset by using an icon mark instead of
  the design image's character illustration (see `FOUNDATION.md`).
