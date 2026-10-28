# 08 — Quality and Testing

> Every number below was produced by **running the actual commands** in this environment just
> now (not recalled from earlier in this project), except the e2e/integration suite, which could
> not be run here — see "What could not be run."

## Test suite counts and last results (run in this pass)

| Suite | Command | Result |
|---|---|---|
| API unit tests | `cd apps/api && npx prisma generate && npx jest --config jest.unit.config.js` | **228/228 passing**, 24 test suites, ~23s |
| Mobile tests | `cd apps/mobile && npx jest` | **544/544 passing**, 58 test suites, ~23s |
| API typecheck | `pnpm typecheck` (runs `prisma generate && tsc --noEmit` for API, plus admin/mobile/shared) | **Clean**, all 4 workspace projects (`apps/admin`, `packages/shared`, `apps/mobile`, `apps/api`) |
| Lint | `pnpm lint` (`eslint .`, repo-wide) | **Clean**, 0 violations |
| Format check | `pnpm format:check` (Prettier `--check`) | **FAILS — 95 files** out of format. See "Known issue" below. |

### What each suite covers

- **API unit** (`apps/api/jest.unit.config.js`): pure-logic and single-service tests — the job
  state machine (`job-state.spec.ts`), fee/pricing math, league-tier computation (both ladders),
  the price-band resolver, geo/ranking math, rate-limiting storage, fraud-detection logic,
  catalog/wallet/dispute/quote-builder services, OTP service, env-schema validation, the error
  envelope filter, crypto helpers, push/payments adapter sandbox behaviour. These run against
  **mocked** Prisma/Redis, not a real database.
- **Mobile**: every screen and most hooks/lib functions, React Testing Library + a mocked
  `fetch`/API layer (`src/test-utils.tsx`'s `mockApi`), i18n key-parity across all 5 locales, the
  design-system components, auth/session store, realtime socket client, location retry queue.

## What could not be run

**The API's end-to-end/integration suite** (`apps/api/jest.integration.config.js`, 19
`*.e2e-spec.ts` files under `apps/api/test/`) spins up **real Postgres+PostGIS and Redis via
Testcontainers** — it genuinely needs a working Docker daemon. This environment has no Docker
daemon available (`docker ps` fails with a connection error to the Docker Desktop pipe), so this
suite was **not run** in this session, including the deletion-flow rewrite done this session
(D-108) and every other API change made across this whole project's history that was never
re-verified here. It **is** run in CI (`.github/workflows/ci.yml`'s `integration` job, on a GitHub
Actions runner that has Docker). The exact command, for a machine that does have Docker:

```
pnpm test:integration
# equivalent to: pnpm build:shared && pnpm --filter @haggler/api test:integration
# equivalent to: cd apps/api && prisma generate && jest --config jest.integration.config.js --runInBand
```

The 19 e2e files, by name (purpose inferred from filename, not independently re-read in this
pass): `admin-fraud`, `admin-moderation`, `auth` (OTP/session/deletion — rewritten this session),
`campus`, `contracts`, `foundation`, `incident-reports`, `jobs` (the core state-machine flow),
`kyc`, `maintenance`, `matching-load`, `monetization`, `notifications`, `parts-pause`,
`quote-flow`, `realtime`, `reputation`, `requests`, `wallet`.

**Important caveat already documented in the code itself** (`fee.service.ts:49-53`, also noted in
`02-job-flow-and-money.md`): because this environment has never had a working Docker daemon to
develop against, `test/harness.ts` **pins `quote_flow_enabled`/`completion_otp_enabled` back to
`false`** for every e2e file that predates D-087 and was never individually rewritten for the new
quote-first flow — "most of them," per the code's own comment. This means **most of the e2e
suite exercises the pre-D-087 legacy flow, not the flow that is actually the production default
today.** Only the files explicitly written for the new flow (`quote-flow.e2e-spec.ts`,
`parts-pause.e2e-spec.ts`, and the deletion test in `auth.e2e-spec.ts` rewritten this session)
are known to test the current default behaviour end-to-end — and none of them, including those,
were actually executed in this session.

## Known issue: `pnpm format:check` currently fails

Running it fresh in this session shows **95 files** out of Prettier formatting, failing the exact
check CI's `verify` job runs on every push/PR. This predates this session's own changes — files
flagged include `docs/DECISIONS.md`, `docs/DESIGN_SYSTEM.md`, `docs/RUNBOOK.md`,
`docs/UI_AUDIT.md`, `eslint.config.mjs`, and `packages/shared/src/marketplace-schemas.ts`, none of
which were touched in this pass. **This means `pnpm format:check` would currently fail CI's
`verify` job if a push triggered it right now** — whether the actual GitHub Actions run is
currently green is UNKNOWN from this local check alone (CI may have been green at the commit it
last ran against, with drift accumulating since, or there may be a `.prettierignore`/config
difference between local and CI not accounted for here). This report's own new files
(`docs/report-source/*.md`) are also flagged — not fixed in this pass, since fixing would mean
running `prettier --write` across the repo, outside this dossier's read-only-analysis scope and
risking an unreviewed change to application code.

## Lint and typecheck: known issues and technical debt

- **Lint and typecheck are both clean** as of this session (0 violations, all 4 workspace projects
  typecheck successfully). No `// eslint-disable` or `@ts-ignore` density scan was run in this
  pass to characterize suppressed issues — not assessed.
- **Legacy state-machine edges are kept alive deliberately** (`job-state.ts:28-34`) purely so a
  job created before D-087 keeps working — not dead code by accident, but it does mean two
  different flows' worth of transition logic coexist in one table indefinitely, which is
  technical debt in the "someone eventually needs to decide when it's safe to remove" sense, not
  a code-quality defect today.
- **The admin console's UI surface is narrower than its API** — 7 pages vs an admin controller
  covering SOS/disputes/incident-reports/fraud-review/config/price-list with no page for any of
  them (see `06-features-by-role.md`). Not a test gap, but worth noting here as a real product gap
  a dossier reader might otherwise assume testing would have caught.

## Smoke test scenarios and their last results

No dedicated smoke-test script or document (e.g. a `smoke.sh`, a Postman/Insomnia collection, or
a documented manual checklist with pass/fail history) was found anywhere in this repository. The
closest equivalents:

- `docs/RUNBOOK.md`'s "before launch" checklist items (seeded price bands, league thresholds
  described as placeholders throughout the codebase) function as a pre-launch checklist, not a
  smoke test with results.
- This session's own manual verification during the 12-item UX fix pass (covered in
  `09-decisions-and-history.md`) was done via automated test suites and code tracing, **not** a
  real device or emulator — explicitly disclosed as a limitation at the time, repeated here: no
  visual/manual smoke test of the running app has been performed and recorded anywhere in this
  repo.
