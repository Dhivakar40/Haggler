# 07 — Trust, Safety, Security

> Source: `apps/api/src/kyc/kyc.service.ts`, `apps/api/src/marketplace/{presence,matching,
> lifecycle,incident,sos,fraud-detection}.service.ts`, `apps/api/src/users/account-hold.service.ts`,
> `apps/api/prisma/schema.prisma` (KYC/safety/fraud enums and models, read in full),
> `apps/api/src/config/env.ts`, `docs/ARCHITECTURE.md`.

## KYC tiers — exactly what each unlocks

Gating checks found by grepping every `kycTier` comparison in `apps/api/src` (8 call sites, all
read directly, not inferred):

| Tier | What it requires (document types, `KycDocumentType`) | What it unlocks | Evidence |
|---|---|---|---|
| 0 (none) | — | Sign in, browse, post a request as a Customer. **Cannot** go online as a Ranger, **cannot** apply to a Contract listing. | — |
| 1 | `AADHAAR_FRONT`, `AADHAAR_BACK`, `SELFIE` (basic identity) | Apply to Contract listings (`contract-applications.service.ts:62`: `kycTier < 1` is refused) | `kyc.service.ts:74` (tier-2 submission requires `kycTier >= 1` first — tiers are sequential, can't skip to 2) |
| 2 | Tier 1 + `ADDRESS_PROOF` + a `ProfessionalReference` (this is the "ready-to-work check" UI item this session moved the category picker into) | **Go online as a Ranger at all** — `presence.service.ts:53`: "Finish verification level 2 before going online" is a hard `forbidden()`, not a warning. Also the threshold for a completed job to count toward the **client's** league (`lifecycle.service.ts:508`) | `kyc.service.ts:78` (tier-3 submission requires `kycTier >= 2` first) |
| 3 | Tier 2 + `TRADE_LICENSE` | Accept a job in a category flagged `requiresLicense` (e.g. gas-appliance work) — checked **twice**: once when building the broadcast list (excludes tier<3 Rangers entirely) and again at accept-time ("a request id is not a secret," per the code comment, so the second check is the one that actually matters) | `matching.service.ts:285-299` |

All three tiers are **manual admin review only** (`ManualAdminKycProvider`) — there is no automated
document-authenticity or face-matching step at any tier (see `05-api-and-realtime.md`).

## Safety features

| Feature | Status | Evidence |
|---|---|---|
| SOS alert | BUILT | `SosAlert` model (`OPEN`/`RESOLVED`), raised by either party mid-job, pushes the other party immediately, queued for a `DISPUTE_AGENT`/`SUPER_ADMIN` to resolve. **Reaching the triggering party's own emergency contacts is a client-side share action**, not a server-sent SMS — the code comment states plainly "this codebase has no SMS adapter [for this purpose]" (`schema.prisma:1220-1228`) |
| Trusted contacts / live-trip sharing | BUILT | `TrustedShare` model; `POST .../share-link` + `.../share-link/revoke` endpoints; a public, token-gated tracking URL (`GET /v1/track/:token`, `GET /t/:token`) a non-Haggler-user contact can open |
| Start-of-job OTP (arrival code) | BUILT | 6-digit, server-issued, hashed+encrypted, expires in 15 min (`job_code_ttl_seconds`), max 5 wrong tries then locked (`arrival_code_max_tries`) — `lifecycle.service.ts:158-198` |
| Completion OTP | **BUILT BEHIND FLAG, default on** | See `02-job-flow-and-money.md`; same hash/lock/expiry pattern |
| Arrival selfie | BUILT, **no automated match** | Required before the arrival code can even be checked (`SELFIE_REQUIRED` if missing) — but it is stored as evidence, not compared against the KYC photo by any code found. "Wrong person arrives" is therefore only partially mitigated: the Ranger must still know the correct arrival code (known only to the matched account), but nothing automatically confirms the selfie is the same person as the KYC submission |
| Check-ins / live location | BUILT | `JobLocation` pings every `location_min_interval_seconds` (4s) during an active job; weak-signal retry queue on the mobile side (`apps/mobile/src/location/retryQueue.ts`) |
| Incident reports | BUILT | `IncidentReport` (`THEFT`/`DAMAGE`/`HARASSMENT`/`DISCRIMINATION`/`ACCIDENT`/`OTHER`), reviewed against the job's own evidence trail (events, photos, GPS, chat) |
| Automatic account hold on a credible report | **BUILT, narrower than the schema's own comment claims** — see Reconciliation below | `incident.service.ts:7-9,46-51`: only `THEFT` and `HARASSMENT` auto-trigger a hold; `DAMAGE`/`DISCRIMINATION`/`ACCIDENT`/`OTHER` do not |
| Suspensions | BUILT, two distinct mechanisms — `TEMPORARY_HOLD` (automatic, reversible, admin-reviewed) vs `SUSPENDED` (an admin's own deliberate action, or the `CUSTOMER_SUSPENDED` dispute resolution) | `account-hold.service.ts`, `DisputeResolution.CUSTOMER_SUSPENDED` |
| Block lists | BUILT | `Block` model, `GET/POST /v1/me/blocks`, `DELETE /v1/me/blocks/:userId` |
| Dispute flow | BUILT, **refund is not automatic** | `Dispute` model, resolutions `REFUND_CUSTOMER`/`PAY_WORKER`/`NO_ACTION`/`CUSTOMER_SUSPENDED`. The schema's own comment states plainly: "No money moves automatically on `REFUND_CUSTOMER`: a real refund needs the same Razorpay-refund-API gap flagged in D-081's token migration-plan report" (`schema.prisma:1261-1265`) |
| Fraud controls | **BUILT, flag-only, never auto-blocking** | `FraudReviewItem` (`VELOCITY`/`REPEAT_PAIR`/`LOW_VALUE` signals), explicit code comment: "never anything that changes a balance or a league by itself" (`schema.prisma:1355-1357`); thresholds in `02-job-flow-and-money.md` |
| Masked calling | **NOT BUILT** | `CallProvider` is an interface only, "no implementation exists (D-019)"; `CALLS_MODE` is pinned to `disabled` (`apps/api/src/adapters/calls/call.provider.ts`) |

### Reconciliation: the schema comment on `IncidentReport` overstates what the code does

`schema.prisma:1312-1315`'s doc comment reads: "A credible report suspends the reported person's
account at once (`User.status = SUSPENDED`, already enforced on every request...)." The actual
code (`incident.service.ts`) does **not** do this for every report, and does not use `SUSPENDED`:

- Only `reason: 'THEFT'` or `reason: 'HARASSMENT'` trigger any automatic action at all.
- That action is `AccountHoldService.holdForSafety`, which sets `User.status = 'TEMPORARY_HOLD'`
  — a distinct, explicitly-documented-as-reversible status, not `SUSPENDED`. `SUSPENDED` is reserved
  for `AdminIncidentsService.resolve()`'s deliberate action after review.
- `DAMAGE`, `DISCRIMINATION`, `ACCIDENT`, `OTHER` reports are logged and queued for review but do
  **not** pause the accused account at all.

The safety *behaviour* this produces (reversible hold for the two most urgent reasons, human
review before anything permanent) looks like a reasonable, deliberate design — it's the schema
comment's wording that's stale/inaccurate relative to it, not the behaviour itself.

## Authentication and authorization

- **OTP login**: 6-digit code (`OTP_LENGTH`/`OTP_TTL_SECONDS` in `apps/api/src/auth/auth.constants.ts`
  — a separate, shorter-lived pair from the in-app job arrival/completion codes), sent by SMS
  (`SMS_MODE`) with an optional email fallback (`EMAIL_MODE`, D-101). `OtpAttempt.codeHash` is
  hashed, never stored raw.
- **Tokens**: 15-minute JWT access token; opaque, SHA-256-hashed, rotating refresh tokens grouped
  in a family — presenting an already-used refresh token revokes the whole family (theft
  detection), per `docs/DECISIONS.md` D-023. Refresh is bound to the device id used at sign-in.
- **Admin auth**: fully separate — email+password (scrypt), a **different JWT audience**, so a
  user token can never be presented as an admin token (D-025).
- **Rate limiting**: global `ThrottlerGuard`, default `THROTTLE_LIMIT=100` requests per
  `THROTTLE_TTL_SECONDS=60` window, store `memory` by default (`THROTTLE_STORE`) — explicitly only
  correct because production currently runs a single Render instance; `docs/RUNBOOK.md` flags
  this must move to `redis` before any horizontal scale-out.
- **Encryption**: `FIELD_ENCRYPTION_KEY`-backed `EncryptionService` for DOB fields, Aadhaar-last-4,
  arrival/completion codes' reversible copies. See `04-data-model.md` for the full field list.
- **Audit logging**: `AuditLog` table, database-trigger-enforced immutable (no `UPDATE`/`DELETE`
  possible even at the DB layer) — see `04-data-model.md`.
- **`TESTING_MODE`**: a fixed OTP code accepted for **any** phone number when `true` (D-100 — an
  earlier phone-number allowlist, D-091, was tried and fully reverted after it broke real tester
  access with no fallback). `env.ts:176-180` refuses to boot with `TESTING_MODE=true` when
  `NODE_ENV=production`. **This guard is deliberately not in effect on the live `haggler-f`
  deployment**: `docs/RUNBOOK.md:326-329` states explicitly that `NODE_ENV` is left at its default,
  `development`, specifically so `TESTING_MODE=true` can keep working there — "a 'hosted but
  still a test environment' deploy is `development` by this schema's own definition, not a new
  value." So the live, publicly-reachable `haggler-f` backend that the current APK points at is,
  by design, running with `NODE_ENV=development` and (per the same doc) `TESTING_MODE=true` —
  meaning **the fixed-code OTP bypass is live and reachable by anyone who knows it today**, not a
  theoretical risk gated by a production flag. Whether this is acceptable depends entirely on
  whether `haggler-f` is understood to be a real production backend or a shared test/staging
  environment that merely happens to be the one real testers and the shipped APK use — that
  product decision is outside this dossier's scope, but the current technical fact is unambiguous.

## Edge-case table

For each scenario the project has discussed, what the code actually does today, with status and
evidence. "Flagged, human review" means no automated resolution — a human (admin) makes the final
call using the evidence the system captured.

| Edge case | What the code does | Status | Evidence |
|---|---|---|---|
| Theft or damage | `IncidentReport` (THEFT/DAMAGE); THEFT auto-holds the account pending review, DAMAGE does not | BUILT (THEFT), BUILT but no auto-hold (DAMAGE) | `incident.service.ts:9` |
| Wrong person arrives | Arrival code known only to the matched account + a required selfie, but **no automated face-match** against the KYC photo | BUILT (code), NOT BUILT (automated identity match) | `lifecycle.service.ts:158-171` |
| Fake ID at KYC | Manual admin review only — relies entirely on a human reviewer's judgment, no document-authenticity or liveness check | STUB (manual-only, no automated check) | `kyc/kyc.provider.ts` (`ManualAdminKycProvider` is the only implementation) |
| Harassment, either direction | `IncidentReport` (HARASSMENT) — auto-holds the accused account immediately, pending review | BUILT | `incident.service.ts:9,46-51` |
| False accusation | The auto-hold for THEFT/HARASSMENT is explicitly documented as reversible/never-permanent ("only `AdminIncidentsService.resolve()`'s SUSPEND path is [permanent]") — an admin clears a bad hold on review | BUILT (reversible-by-design; relies on a human getting it right) | `account-hold.service.ts` comment, `incident.service.ts:45` |
| Off-app payment (avoiding the platform fee) | **No detection mechanism found.** The flag-only fraud signals (velocity/repeat-pair/low-value) catch *suspicious patterns*, not direct evidence of off-app payment | NOT BUILT | `fee.service.ts:65-76` (the only fraud-adjacent config) |
| Inflated quotes | Every labour line is capped at `quote_ceiling_multiple_bps` (1.5× the price-list floor) by default, enforced server-side at quote-submission | BUILT | `fee.service.ts:29-31,84`; `02-job-flow-and-money.md` |
| Floor quoting (quoting exactly at the legal floor to game something) | No code found treating a floor-priced quote specially; it's simply a valid quote within the allowed band | Not a distinct code path — the ceiling cap is the only quote-price control that exists | `fee.service.ts` |
| Extra cash demand on top of a quote | The quote-ceiling cap + the one capped "extra" line (10% of labour) are the only server-enforced price controls; a verbal off-app demand for more cash is not technically preventable by the app | Partially mitigated (caps the *quoted* price); the cash-handoff itself is unobservable to the server | `fee.service.ts:32-33,85` |
| Customer refusing to pay | `DisputeResolution.CUSTOMER_SUSPENDED` — "raised by the Ranger when a customer won't pay for finished work — the account is suspended... and the job carries no warranty" | BUILT | `schema.prisma:1258-1265` |
| Withheld completion code | Payment auto-releases to the Ranger after `completion_otp_auto_release_hours` (24h default) if nobody confirms and no dispute is open | BUILT | `fee.service.ts:38-41,92`; `02-job-flow-and-money.md` |
| Rejected quote | `QUOTE_REJECTED` — a terminal state, distinct from `CANCELLED` specifically so a visit-fee settlement stays unambiguous in reporting | BUILT | `job-state.ts:22-23,53,69` |
| Extension abuse (repeated parts-pause) | Hard cap: `max_parts_extensions` (2 per job) and `max_concurrent_paused_jobs_per_worker` (2) | BUILT | `fee.service.ts:42-45,93-94` |
| Parts bought then job cancelled | A pause can end in `CANCELLED` (customer declines the extension); no code was found reimbursing a Ranger for parts already purchased in this case — the visit-fee mechanism is the only compensation path identified | Partially built — cancellation path exists; parts-cost reimbursement not found | `job-state.ts:55` (`PAUSED_PARTS → CANCELLED`) |
| Item taken to a workshop | `ItemHandover` model exists (signed-off handovers, per the route `jobs/:id/handovers[/:handoverId/sign-off]`) — a custody record, not independently re-read in full detail this pass | BUILT (custody tracking exists) | `schema.prisma` `ItemHandover`; `marketplace/requests.controller.ts:512-525` |
| League-bonus farming | Rating-count floors, cancellation-rate ceilings on both ladders, the KYC-tier-2 "genuinely verified Ranger" requirement for a booking to count toward a client's league, plus the flag-only velocity/repeat-pair/low-value fraud queue | BUILT (layered mitigations, none of them auto-blocking) | `06-features-by-role.md`; `lifecycle.service.ts:489-515` |
| Multi-accounts (same person) | `WorkerProfile.identityHash`, a unique one-way hash, used for duplicate-identity detection; `admin fraud-review/multi-account-candidates` endpoint surfaces candidates for a human to review | BUILT, flagged for human review | `schema.prisma:484`; `admin/admin.controller.ts:321` |
| Duplicate payments | No dedicated duplicate-payment detection code was found; `PaymentOrder`/`JobPayment` are keyed per job, and Razorpay's own idempotency (order id reuse) is the only structural protection identified | UNKNOWN / not independently verified | — |
| No Ranger responds | After exhausting all configured broadcast waves/radii, the job **times out** and the customer is explicitly given the choice to re-broadcast or cancel — no silent failure | BUILT | `matching.service.ts:124-128` |
| Ranger no-show | Customer reports after `worker_no_show_minutes` (30 min) → `NO_SHOW_WORKER`, which can re-broadcast or resolve to a refund | BUILT | `job-state.ts:65`; `02-job-flow-and-money.md` |
| Weak GPS signal | A dedicated client-side retry queue persists failed location pings and resends them | BUILT | `apps/mobile/src/location/retryQueue.ts`, D-085 |
