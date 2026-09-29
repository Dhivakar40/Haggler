# Architecture (Phase 0)

```
 apps/mobile (Expo)            apps/api (NestJS)                  infra (docker compose)
 ┌──────────────────┐  HTTPS   ┌─────────────────────────┐       ┌──────────────────┐
 │ Expo Router      │─────────▶│ Helmet · Throttler      │──────▶│ Postgres16+PostGIS│
 │ TanStack Query   │  JSON    │ ValidationPipe / ZodPipe│       ├──────────────────┤
 │ Zustand (prefs)  │◀─────────│ Controllers /v1/*       │──────▶│ Redis 7          │
 │ i18n (5 langs)   │  errors  │ ErrorEnvelopeFilter     │       ├──────────────────┤
 └──────────────────┘          │ Pino logs · Prometheus  │──────▶│ MinIO (S3, dev)  │
        ▲                      └─────────────────────────┘       └──────────────────┘
        │ shared zod schemas, constants, error codes
        └────────────── packages/shared ─────────────────────────────┘
```

## Monorepo

| Path              | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `packages/shared` | Types, zod schemas, constants, cursor pagination. Compiled to `dist/` (CJS) |
| `apps/api`        | NestJS REST API (+ Socket.IO from Phase 2), Prisma, BullMQ from Phase 2     |
| `apps/mobile`     | Expo app: design system, i18n, app shell                                    |
| `apps/admin`      | Next.js admin console (starts Phase 1, D-014)                               |

## Request lifecycle (API)

1. `pino-http` assigns or echoes `x-request-id` (≤ 64 chars) and logs with secrets redacted.
2. Helmet sets security headers; `ThrottlerGuard` enforces 100 req/min/IP.
3. URI versioning routes `/v1/...`. `ValidationPipe` (class-validator) or `ZodPipe` (shared zod
   schema) validates; unknown fields are rejected.
4. Controller → service → Prisma/Redis.
5. Any error goes through `ErrorEnvelopeFilter` → `{ error: { code, message, details?, requestId } }`.
   Unknown errors are logged with stack but shown to the client as a generic message.
6. `HttpMetricsMiddleware` records latency by _route pattern_ (bounded label cardinality).

## Adapter pattern (third parties)

Each vendor gets an interface plus two implementations: a **live** adapter (env-configured) and a
**sandbox** adapter (deterministic fake for dev/tests). Mode per adapter comes from `*_MODE`.
`/health/ready` and the mobile Settings screen show which are live, so nobody mistakes a
sandbox for production. Production boot fails if any adapter is sandboxed (D-012).
Phase 0 ships the configuration and reporting; adapters land with their features (SMS in Phase 1, etc.).

## Data (foundation)

`users`, `user_roles`, `devices`, `refresh_tokens`, `otp_attempts`, `addresses` (PostGIS point +
GIST index), `service_categories`, `price_bands`, `admin_users`, `admin_roles`, `audit_logs`
(append-only via trigger), `feature_flags`, `system_config`, `minimum_wage_rules`.
See `apps/api/prisma/schema.prisma` and `docs/DECISIONS.md` (D-001, D-002, D-008).

## Mobile design system

- Tokens (`src/theme/tokens.ts`): light/dark palettes, 4-pt spacing, radii, type scale,
  `MIN_TOUCH_TARGET = 48`. Contrast of every text/background pair is asserted ≥ 4.5:1 in tests.
- Components (`src/components`): Text, Button, Card, Chip, Screen, Loading/Error/Empty states.
  All expose roles and states to screen readers; text scales with the OS setting (capped at 1.6×).
- Preferences (theme, language) persist locally; no server round trip.
- Every user-facing string comes from i18n keys; tests enforce identical key sets across
  en/hi/ta/kn/te and forbid the word "worker" (D-003).

# Phase 1 additions

## Identity and sessions

```
 phone ──otp/send──▶ [limits: 30 s cooldown · 5/h/phone · 20/h/IP · lockout after 10 wrong codes]
   │                    Redis first, Postgres fallback (otp_attempts)          ┌──────────────┐
   │                    code = 6 digits, HMAC-hashed, 5 min TTL ─────────────▶│ SmsProvider  │ sandbox | MSG91
   └──otp/verify──▶ atomic single-use claim ─▶ user (created on first sign-in) └──────────────┘
                     └─▶ device bound ─▶ access JWT (15 min) + rotating refresh token (hashed, per-family)
```

- **Global guards**, in order: throttler (Redis-backed, per IP) → `JwtAuthGuard` (every route unless
  `@Public()`; re-reads account status and roles from the DB each request) → `RolesGuard` (`@Roles`).
- **Refresh rotation**: each use retires the token and issues the next in the same family; presenting
  a retired token revokes the family (theft detection). Tokens are bound to the device id.
- Admin tokens use a **different secret and audience**, so a user token can never open an admin
  route and vice versa.

## Verification (manual review, D-016)

```
Ranger phone ──1 presign──▶ API ──signed PUT url (5 min, size+type bound)──▶ phone
      │                                                                        │
      └──2 PUT file ────────────────────────────────────────────────────────▶ private bucket (MinIO/S3)
      └──3 confirm ──▶ API checks the object exists at the declared size
      └──4 submit ───▶ KycProvider(manual_admin) ─▶ status PENDING_REVIEW ─▶ admin queue
Admin (Next.js, httpOnly cookie) ─ views images side by side (2-min links, each view audit-logged)
      └─ approve (needs DOB + Aadhaar last 4; under-18 refused) | reject (reason) | request info
```

`kyc_checks.provider` is `manual_admin`; a vendor adapter can replace it without a schema change.

## Admin app (`apps/admin`)

Server components and actions call the API; the token lives in an httpOnly, SameSite=Strict cookie
so page scripts cannot read it. CSP allows images only from this origin and the storage host.

# Phase 2 additions

## Marketplace lifecycle

```
Customer: create request (media + optional voice, price band shown)
   │  RequestsService ──▶ status REQUESTED ──▶ BROADCASTING (wave 1 built immediately)
   ▼
SchedulerService.tick() [DB poller] ──▶ builds wave 2 (5km) / wave 3 (10km) as deadlines pass
   │  each wave: top 5 candidates by rankCandidates() (distance .4, badge .2, fairness .2,
   │             smoothed acceptance .2, soft gender-match bonus .1); pushed over Socket.IO
   ▼
Ranger: request.accept ──▶ Redis NX lock (10s) ──▶ KeyedMutex(jobId) ──▶ Postgres txn:
   │        updateMany(BROADCASTING → MATCHED, guarded by status) + job_matches UNIQUE(job_id)
   │        + partial unique index jobs_one_active_per_worker (a Ranger can hold only one active job)
   ▼        (both DB guards are the source of truth; Redis only narrows the race window — D-029)
NegotiationService: up to 3 rounds of offer/counter/accept/reject; a price outside the usual band
   │  needs an explicit confirm from whoever is accepting it; either offer or acceptance can expire.
   ▼
JobTransitions.move() [the only code that writes jobs.status]: AGREED → EN_ROUTE → ARRIVED
   │  (geofence 500m to attempt the code) → 4-digit code verified (HMAC hash, 5 tries, D-034)
   │  → before photo (camera only) → IN_PROGRESS → after photo → COMPLETED_BY_WORKER
   ▼
Customer confirms ──▶ CONFIRMED_BY_CUSTOMER (terminal). Every transition appends an
                       append-only job_events row (DB trigger blocks UPDATE on that table).
```

Realtime (`realtime.gateway.ts`, Socket.IO, per-user rooms `user:<id>`) delivers
`request.broadcast/taken/matched/timeout`, `job.updated`, `offer.updated`, `location.update` and
`chat.message` as **hints only** — every mobile screen re-reads over REST on a hint (or on its own
poll interval) rather than trusting the socket payload as truth, so a missed event degrades to "catches
up on the next poll", never silent staleness. Single-instance today (D-031).

## Live tracking and chat

`TrackerHost` (mobile) is the one place that streams the Ranger's GPS: online-with-no-job uses a
relaxed heartbeat (10s/20m), an active job tightens to 5s/10m en-route and 15s once arrived/in
progress, each fix sent over the live socket with a REST fallback. A `TrustedShare` link (256-bit
token, only its hash stored, 12h expiry) exposes the same trip read-only at `/t/:token` with no
sign-in. Chat (`ChatScreen`) is in-app only — no phone numbers are ever exchanged; messages are saved
on the server first (REST or socket-with-ack) and a `clientMsgId` makes a retry idempotent, never a
duplicate.

## Maintenance and scheduling split (D-030)

The broadcast/timeout scheduler is a DB poller (`SchedulerService.tick()`), not a queue: request state
is read straight from `jobs`, so "what will broadcast next" is one SQL query away. BullMQ is reserved
for `purge-accounts`, `purge-kyc-images`, `trim-auth-data` and `trim-gps-trails` — batch jobs that need
real retry/backoff and a dead-letter set, not sub-second latency.

# Phase 3 additions

## Customer wallet: hold, consume, release (D-037/D-038)

```
Customer buys a token bundle ──▶ PaymentsProvider.createOrder() ──▶ payment_orders row (CREATED)
   │  paid via Razorpay Checkout (test mode) or the sandbox screen
   ▼
WalletService.credit() [race-safe: client /verify AND the webhook both call this, whichever
   │  arrives first wins via an updateMany(status: CREATED) guard] ──▶ balance_tokens += N,
   ▼     a PURCHASE wallet_ledger_entries row

RequestsService.create() [same transaction as the request/job insert]:
   │  WalletService.hold() ──▶ balance -1, held +1, a wallet_holds row (status HELD, UNIQUE job_id)
   ▼  throws INSUFFICIENT_TOKENS (422) if balance_tokens < 1

JobTransitions.move() [the one place jobs.status changes — see Phase 2]:
   │  to CONFIRMED_BY_CUSTOMER      ──▶ WalletService.consume(): held -1 (permanently spent)
   │  to CANCELLED / NO_SHOW_*      ──▶ WalletService.release(): held -1, balance +1 (given back)
   ▼  every other transition: no wallet effect
```

Rangers are never part of this diagram (D-037): the Ranger's own payment (cash/UPI, direct from the
customer, in full) from Phase 2 is completely untouched. `wallet_ledger_entries` is append-only (same
DB-trigger pattern as `job_events`) and each row records both `tokensDelta` (balance) and `heldDelta`
(held), so the ledger alone can reconstruct the wallet's counters — checked directly by an
integration test.

## Payments adapter (`adapters/payments`)

`PaymentsProvider` has two implementations picked by `PAYMENTS_MODE` (D-020): `sandbox` (no gateway
called; signs with a fixed dev secret using the real HMAC algorithm, so signature verification is
genuinely exercised even without Razorpay) and `razorpay` (`test` mode only, `rzp_test_` keys). Both
implement the same interface: create an order, verify a Checkout callback's signature, verify a
webhook's signature. Two independent paths can settle a top-up — `POST /wallet/topup/:id/verify`
(client callback, fast) and `POST /webhooks/razorpay` (server-to-server, authoritative) — and both
funnel through the same guarded `credit()` so a double-credit is structurally impossible (D-041).

# Phase 4 additions

## Reviews and badge tiers (`src/reputation`)

```
Job reaches CONFIRMED_BY_CUSTOMER
   │  ReviewsService.submit() [one row per (jobId, raterRole), enforced by a DB unique index]:
   │    CUSTOMER rates WORKER ──▶ WorkerStats.ratingSum/ratingCount += rating
   │                                ──▶ ReputationService.recomputeWorkerBadge() [pure fn, see below]
   │    WORKER rates CUSTOMER   ──▶ CustomerStats.ratingSum/ratingCount += rating (no badge; D-047)
   ▼
JobTransitions.move() [same Phase 2 choke point]:
   to CONFIRMED_BY_CUSTOMER ──▶ WorkerStats.jobsCompleted += 1 ──▶ recomputeWorkerBadge() again
```

`computeBadgeTier(jobsCompleted, ratingSum, ratingCount, thresholds)` in `reputation/badge-tier.ts`
is pure and exhaustively unit-tested: it walks a ladder of thresholds (DIAMOND down to BRONZE),
each requiring both a job-count floor AND a rating-count-and-average floor, so neither volume alone
nor one lucky review can buy a tier (D-045). Thresholds are DB-overridable via
`system_config.badge_tier_thresholds` (`ReputationConfig`, same caching/override pattern as
`MarketplaceConfig`).

## Blocking (`src/reputation/blocks.service.ts`)

The matching exclusion (`presence.service.ts`'s candidate query checks both directions) has existed
since Phase 2; this phase adds `GET/POST /me/blocks` and `DELETE /me/blocks/:userId`. Blocking is an
idempotent upsert (blocking twice updates the reason, never errors) and one-directional to create,
but protects both people because the matching query already checks both directions (D-047).
