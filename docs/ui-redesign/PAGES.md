# UI redesign from design images — page tracker

Branch: `ui/redesign-from-images`. One row per design image received. Commit hash: see
`git log --oneline -- <files>` for the page (each page is one commit,
`ui(<page>): rebuild from design image`).

| Page | Files | Status |
|---|---|---|
| Sign-in / landing (`PhoneScreen`) | `features/auth/PhoneScreen.tsx`, `components/Button.tsx`, `components/TextField.tsx`, `i18n/locales/*.ts` | Done — also set the app-wide foundation (see `FOUNDATION.md`) |

## Not implemented, needs a decision

- **Pre-auth Terms of Service / Privacy Policy links** (sign-in page): the design shows them as
  tappable links, but `legal/index` and `legal/[doc]` are currently gated to signed-in users only
  (`app/_layout.tsx`). Showing them pre-auth needs a routing-guard change, which is out of scope
  for a UI-only pass — flag if you want that guard opened up.

## Assets needed

- None yet. Page 1 (sign-in) avoided needing an illustration asset by using an icon mark instead of
  the design image's character illustration (see `FOUNDATION.md`).
