# 01 — Overview and Status

> Source of truth: the code in this repository as of commit `4c003de` (2026-10-28,
> `git log -1 --format=%H` = `4c003de...`, branch `main`, working tree clean at time of writing).
> Where this document and `docs/DECISIONS.md` or the original master prompts disagree, this
> document follows the code and says so explicitly in the Reconciliation section below.

## What the app does, in plain language

Haggler is an Indian on-demand local-services marketplace mobile app (Android, via Expo), with a
companion admin web console. A **Customer** posts a service request (electrician, plumber,
cleaner, AC repair, etc.); the request is broadcast to nearby verified **Rangers** (home-service
workers); a Ranger accepts, travels, inspects the job, sends a priced quote, and — once the
customer accepts — does the work, gets paid (cash or in-app), and the job settles. Beyond the core
on-demand job, the same backend and a shared design system also run three adjacent marketplaces
reachable from the same app:

- **Contract jobs** — longer-term work an **Employer** posts for a Ranger to apply to and be hired for.
- **Campus jobs** — part-time work an Employer posts for a **Student** to apply to.
- **"Other"** — a catch-all service category with its own free-text quote flow instead of a fixed price list.

An **Admin** (separate login, separate web app in `apps/admin`) reviews KYC submissions, disputes,
incident reports, fraud signals, and holds configuration knobs (price list, fee %, feature flags).

## User roles

Source: `packages/shared/src/constants.ts:5` (`USER_ROLES`) and `prisma/schema.prisma:21`
(`RoleType`). A single `User` row can hold more than one role at once (`UserRole` join table).

| Role (DB enum) | Shown to the user as | What they can do |
|---|---|---|
| `CUSTOMER` | "Customer" | Post on-demand requests, browse/apply to nothing (they post, not apply), pay, rate, use Haggler Plus, build a client league. |
| `WORKER` | **"Ranger"** — the word "worker" is deliberately never shown in the UI (enforced by a test assertion, see `apps/mobile/src/features/account/account.spec.tsx`) | Go online, receive broadcasts, quote and complete on-demand jobs, browse/apply to Contract jobs, earn via the worker wallet, build a Ranger league. |
| `EMPLOYER` | "Employer" | Post Contract and Campus listings, review applicants, hire. |
| `STUDENT` | "Student" | Browse/apply to Campus listings, maintain an extended student profile. |
| *(not a `UserRole`)* `AdminUser` with `AdminRoleType` (`KYC_REVIEWER`, `DISPUTE_AGENT`, `FINANCE`, `SUPER_ADMIN`) | Admin console user | Separate login (email+password, `apps/api/src/admin`), separate JWT audience so a user token can never act as admin (D-025). |

## Master status table

Status legend: **BUILT** (shipped, no flag), **BUILT BEHIND FLAG** (shipped, gated by a runtime
flag — default noted), **STUB** (placeholder/sandbox only, not a real integration), **NOT BUILT**.

| Feature | Status | Flag / default | Evidence |
|---|---|---|---|
| OTP phone login (SMS) | BUILT (sandbox in dev) | `SMS_MODE` env, no default — must be set; refused at boot if unset in production | `apps/api/src/adapters/sms/`, `apps/api/src/config/env.ts` |
| OTP email fallback | BUILT | `EMAIL_MODE`, sandbox allowed even in prod (deliberate, D-101) | `apps/api/src/adapters/email/`, `otp-schemas` in shared |
| `TESTING_MODE` fixed-code bypass | BUILT | `TESTING_MODE` env bool, any phone when true, no allowlist (D-100) | `apps/api/src/auth/otp.service.ts` |
| Mandatory onboarding (name/DOB/gender/email) | BUILT | — | `apps/api/src/users/users.service.ts` `completeOnboarding` |
| Manual KYC (tier 1/2/3) | BUILT | `KYC_PROVIDER` env (adapter abstraction; current adapter is manual-admin-review, not a live face-match vendor) | `apps/api/src/kyc/` |
| On-demand job: fixed price list | BUILT | — | `apps/api/prisma/schema.prisma` `PriceListEntry`/`PriceListAddOn`, `apps/api/src/catalog/` |
| On-demand job: quote-first flow (travel → diagnose → line-itemised quote → accept/reject) | **BUILT BEHIND FLAG**, flag **default true** | `quote_flow_enabled` (SystemConfig, default `true` since D-096) | `apps/api/src/marketplace/fee.service.ts:46-54,95` |
| Completion code (customer enters a server-issued code to release payment) | **BUILT BEHIND FLAG**, flag **default true** | `completion_otp_enabled` (SystemConfig, default `true` since D-096) | `fee.service.ts:55-64,96` |
| Cash payment | **BUILT BEHIND FLAG**, flag **default false** | `cash_enabled` (SystemConfig, default `false` — in-app payment only, D-089) | `fee.service.ts:25-28,83` |
| Online payment (Razorpay) | BUILT, sandbox keys only in this environment | `PAYMENTS_MODE`; only `rzp_test_...` keys accepted (hard refusal of live keys, D-020) | `apps/api/src/adapters/payments/`, `apps/api/src/config/env.ts:~150` |
| Auto-release of worker earnings | **NOT BUILT** (corrected after file 02 was written — see that file) | `completion_otp_auto_release_hours` = 24 is defined but **no code reads it**; `docs/RUNBOOK.md`'s own checklist independently flags this exact gap | `fee.service.ts:38-41,92` (definition only, no consumer found) |
| Pause-for-parts mid-job | BUILT | `max_parts_extensions`=2, `max_concurrent_paused_jobs_per_worker`=2 | `fee.service.ts:42-45,93-94` |
| Visit fee (distance-banded) | BUILT, placeholder amounts | `visit_fee_bands` (3 bands, ₹99/₹149/₹199 — explicitly marked "placeholder" in code) | `fee.service.ts:86-90` |
| Customer Wallet (token top-up/purchase) | **NOT BUILT (UI removed this session)**; backend tables/endpoints untouched | — | D-106 (`docs/DECISIONS.md`); `WalletScreen.tsx` now shows only Plus, not tokens; `CustomerWallet`/`TokenBundle` Prisma models and their endpoints still exist and are reachable, just not linked from the UI |
| Haggler Plus subscription | BUILT | — | `apps/api/src/monetization/plus.controller.ts`, `apps/mobile/src/features/wallet/WalletScreen.tsx` |
| Worker Wallet / earnings / dues | BUILT | `worker_dues_threshold_paise` = ₹500 default | `apps/api/src/wallet/worker-wallet.service.ts` |
| Contract jobs (Employer ↔ Ranger) | BUILT | — | `apps/api/src/contracts/`, `apps/mobile/src/features/contracts/` |
| Campus jobs (Employer ↔ Student) | BUILT | — | `apps/api/src/campus/`, `apps/mobile/src/features/campus/` |
| Client League / Ranger League (gamified tiers) | BUILT | — | `apps/api/src/reputation/` |
| SOS alert | BUILT | — | `prisma/schema.prisma` `SosAlert`; `apps/api/src/marketplace/sos.service.ts` |
| Dispute flow | BUILT | — | `prisma/schema.prisma` `Dispute`; `apps/api/src/marketplace/dispute.service.ts` |
| Incident reports + temporary account hold | BUILT | — | `apps/api/src/users/account-hold.service.ts`, D-093 |
| Fraud review queue (league-bonus farming etc.) | BUILT, flags-only (never auto-blocks) | `fraud_velocity_max_jobs`=15/24h, `fraud_repeat_pair_max_count`=5/30d, `fraud_min_job_value_paise`=₹50 | `fee.service.ts:65-75,97-101`; `apps/api/src/marketplace/fraud-detection.service.ts` |
| Blocked users | BUILT | — | `prisma/schema.prisma` `Block` |
| Push notifications (FCM) | BUILT | `PUSH_MODE` env; a device's token can be cleared by a new "Push notifications" setting toggle (D-107) | `apps/api/src/adapters/push/`, `apps/mobile/src/notifications/` |
| Real-time job tracking (sockets) | BUILT | — | `apps/api/src/realtime/`, `apps/mobile/src/realtime/` |
| Location weak-signal retry queue | BUILT | — | `apps/mobile/src/location/retryQueue.ts`, D-085 |
| Account deletion (DPDP erasure) | BUILT, behaviour changed this session | 48-hour grace period, account stays `ACTIVE`/usable the whole time, cancellable (D-108; supersedes D-024's 30-day locked-out version) | `apps/api/src/users/users.service.ts` `requestDeletion`/`cancelDeletion` |
| Data export (DPDP access right) | BUILT (backend); **UI entry point removed this session** | — | `GET /v1/me/export` still live, `AccountScreen.tsx`'s "Download my data" row removed (D-108) |
| Admin console (KYC review, disputes, config, price list) | BUILT | — | `apps/admin/src` |
| CI (lint/typecheck/unit/OpenAPI-drift/dependency-audit/integration/admin-build/mobile-bundle) | BUILT | — | `.github/workflows/ci.yml` |
| Face-matching KYC (automated) | NOT BUILT | — | `KYC_PROVIDER` adapter is manual-review only; no vendor integration found in `apps/api/src/kyc/` |
| Insurance | NOT BUILT | — | no model, no code found |
| Live payouts to Ranger bank accounts | NOT BUILT (sandboxed) | — | `PAYMENTS_MODE`/payments adapter is sandbox; no payout/settlement-to-bank code found |

## Reconciliation — where the current build differs from the docs / master prompts

This repo's `git log` shows 87 commits from `92cc4d9` (Phase 0 foundation) to `4c003de`
(D-108, latest). The original "Phase Flow-Final" master prompt work runs through roughly D-087
to D-096 (`git log --oneline | grep -iE "flow-final|D-08[7-9]|D-09[0-6]"`). Everything from
**D-097 onward (`384faac` through `4c003de`) was driven by direct user prompting after the
master-prompt phases finished**, responding to real production issues and a 12-item UX punch
list. Specific divergences:

1. **`docs/DECISIONS.md` has no entries for D-097 through D-099, or D-102 through D-107.**
   Those commits exist in `git log` (`384faac` D-097 lint fixes, `e8fa331` D-099 migration fix,
   `f4ba12a` D-102 through `02635bb` D-106, `c4d4526` D-107) with descriptive commit messages,
   but no corresponding `## D-0xx` section was ever added to the decisions log. D-108 (this
   session) is the first of that run to also get a full `DECISIONS.md` entry. **If you rely on
   `DECISIONS.md` alone you will miss six real, shipped changes.** `git log` is the only complete
   record for that stretch.
2. **Account deletion (D-024) is superseded, not just extended.** D-024 as written says "`DELETE
   /me` marks the account `DELETION_PENDING`, revokes all sessions and blocks sign-in... After 30
   days, purge." That is no longer true. D-108 (this session) changed it by explicit product
   instruction: the account stays `ACTIVE` and fully usable for 48 hours, nothing is revoked, and
   a cancellable top banner appears instead. `DECISIONS.md`'s D-024 entry itself was **not**
   edited to reflect this — D-108's entry is additive, so a reader of D-024 in isolation gets the
   wrong current behaviour.
3. **The Customer Wallet's token-purchase UI was removed, not the backend.** D-081 replaced
   tokens with the pay-after platform fee as the real monetization model; the token
   balance/top-up *UI* nonetheless stayed in the app until D-106 (this session) removed it. The
   `CustomerWallet`, `TokenBundle`, `WalletLedgerEntry` tables and their API endpoints are
   untouched and still reachable — this is a UI-only removal, consistent with this project's
   stated "stop calling it, never delete it" policy (D-081/D-106), not a backend deprecation.
4. **TESTING_MODE allowlist (D-091) was added, then fully reverted (D-100)** within the commit
   history — `docs/DECISIONS.md` has both entries, so this one *is* reconciled in the docs, but
   it's called out here because anyone reading only D-091 (without reaching D-100 later in the
   file) would believe an allowlist still exists. It does not.
5. **`quote_flow_enabled` and `completion_otp_enabled` default to `true`**, per D-096, not the
   conservative "off until verified" posture the master prompt originally implied for a
   newly-finished flow. This is documented in D-096 and confirmed live in
   `fee.service.ts:95-96`.
6. **No Render `render.yaml` or Postgres service exists in this repo/project.** The production
   database is an external Supabase Postgres (ap-south-1), not a Render-managed database, despite
   the API being hosted on Render. Nothing in the docs states this explicitly; it was confirmed
   this session by reading the live `DATABASE_URL` on the deployed service. See
   `03-architecture-and-stack.md` and `11-handover.md`.

## UNKNOWN

- Whether `KYC_PROVIDER`, `MAPS_MODE`, `CALLS_MODE` have ever been set to anything other than
  their sandbox adapters in the live Render environment — not inspectable from the repo alone
  (env values were not read beyond `DATABASE_URL`, and reading further was out of scope for a
  read-only code dossier).
- Whether the admin console (`apps/admin`) is actually deployed anywhere right now — no deploy
  config or URL for it was found in this repo.
