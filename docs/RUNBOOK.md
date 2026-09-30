# Runbook

## Start everything (local)

```bash
pnpm install
cp .env.example apps/api/.env          # PowerShell: Copy-Item .env.example apps/api/.env
pnpm dev:infra                         # Postgres+PostGIS :5433, Redis :6379, MinIO :9000/:9001
pnpm build:shared
pnpm db:migrate && pnpm db:seed
pnpm api:dev                           # http://localhost:3000  (docs UI at /docs)
pnpm mobile:start                      # Expo dev server
pnpm admin:dev                         # http://localhost:3001 (needs an admin account, below)
```

### Signing in on a phone during development

- The API prints the OTP to its console (sandbox SMS). Read it there.
- A **physical phone** cannot reach `localhost`. Use your PC's LAN IP (`ipconfig`):
  - `apps/mobile/.env`: `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3000`
  - `apps/api/.env`: `S3_PUBLIC_ENDPOINT=http://<LAN-IP>:9000` (this is the host inside upload links)
  - Allow ports 3000 and 9000 through the Windows firewall.
- The Android emulator reaches your PC at `10.0.2.2`; use that instead of the LAN IP.

### Create an admin

```bash
ADMIN_PASSWORD='a-passphrase-of-12+-characters' pnpm --filter @haggler/api admin:create \
    --email reviewer@example.com --name "Priya" --roles KYC_REVIEWER
```

Roles: `KYC_REVIEWER`, `DISPUTE_AGENT`, `FINANCE`, `SUPER_ADMIN` (comma-separated). Running it again
for the same email resets the password and roles. The password comes from the environment so it
never appears in shell history.

## Maintenance jobs (BullMQ, Phase 2)

`purge-accounts`, `purge-kyc-images`, `trim-auth-data` and `trim-gps-trails` run as BullMQ jobs with
retries/backoff and a failed-job dead-letter set, driven by the API process when `QUEUES_ENABLED=true`
(default). They can still be triggered by hand for a one-off run or when queues are disabled for a test:

```bash
pnpm --filter @haggler/api job purge-accounts     # anonymise accounts whose 30-day deletion grace ended
pnpm --filter @haggler/api job purge-kyc-images   # delete identity images past kyc_image_retention_days (30)
pnpm --filter @haggler/api job trim-auth-data     # delete expired refresh tokens / old otp_attempts
pnpm --filter @haggler/api job trim-gps-trails    # delete job_locations rows past the 90-day retention
```

All four are idempotent. If they never run, the retention promises in COMPLIANCE.md are **not** kept —
check the BullMQ failed-job set (below) if a retention deadline looks like it was missed.

## Marketplace scheduler and realtime (Phase 2)

- The broadcast/timeout scheduler (`SchedulerService.tick()`) runs in-process on an interval when
  `SCHEDULER_ENABLED=true` (default); it needs no separate worker. Set it `false` in a test that drives
  ticks by hand.
- `PUBLIC_BASE_URL` is the base used to build the public live-tracking link (`/t/:token`) that customers
  share; set it to the real public URL before any real deployment.
- Socket.IO runs the Redis adapter as of Phase 5 (D-031/D-053, see below), so more than one API
  instance in production no longer drops realtime events for clients connected to a different
  instance — a missed event still self-heals on the next REST poll regardless.
- The public OpenStreetMap raster tile server (`tile.openstreetmap.org`) used by the live map is for
  light development use only — it has a strict usage policy and will rate-limit or block at production
  traffic. Replace it with a hosted or self-hosted tile provider before launch.
- MapLibre native rendering needs a **dev build** (`expo run:android`/EAS), not Expo Go — in Expo Go the
  map screen falls back to a text readout of the Ranger's coordinates plus an "open in maps" button,
  which still works but is not the real map.

## Checks

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test:unit
pnpm test:integration     # needs Docker running; spins up throw-away containers
pnpm openapi              # regenerates docs/openapi.json and docs/API.md
```

## Reset the local database

```bash
docker compose down -v    # deletes the volumes (all local data, including uploaded files)
pnpm dev:infra && pnpm db:migrate && pnpm db:seed
```

## Wallet and payments (Phase 3)

- Default `PAYMENTS_MODE=sandbox`: no gateway is called; `POST /wallet/topup/:id/sandbox-pay`
  completes a top-up instantly (refused when `PAYMENTS_MODE=test`). This is the only path exercised
  by the mobile app's own tests and by hand in Expo Go — see D-043 for the real-Checkout gap.
- To try real Razorpay TEST payments, set `PAYMENTS_MODE=test` and fill `RAZORPAY_KEY_ID` (must
  start with `rzp_test_`), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` from your Razorpay TEST
  dashboard. The API refuses to boot with a live key (D-020).
- Point Razorpay's webhook (test dashboard → Webhooks) at
  `https://<your-host>/v1/webhooks/razorpay`, subscribed to `payment.captured`, using
  `RAZORPAY_WEBHOOK_SECRET` as the signing secret. Locally, use a tunnel (ngrok or similar) since
  Razorpay cannot reach `localhost`.
- Token bundles (`token_bundles` table, prices in paise) are seeded by `pnpm db:seed`
  (`starter-3`/`value-10`/`saver-25`, placeholder prices) — review before launch, same as the
  DEFAULT price bands.
- Haggler Plus plans (`plus_plans` table, Phase 9, D-069) are seeded the same way
  (`plus-customer-monthly`/`plus-employer-monthly`, placeholder prices and a 10% token-bundle
  discount) — review before launch. Rush fee and Boosted Listing fee amounts live in
  `system_config` under key `monetization_settings` (`rush_fee_paise`, `boost_fee_paise`,
  `boost_duration_days`; defaults ₹49 / ₹199 / 7 days), same DB-overridable-without-a-deploy
  pattern as `MarketplaceConfig`/`CampusConfig`.
- `PAYMENTS_SANDBOX_SECRET` signs sandbox payments; it has a fixed dev default and is never used
  when `PAYMENTS_MODE=test`, so it does not need to be set for a real deployment.

## Push notifications (Phase 5)

- Default `PUSH_MODE=sandbox`: no push leaves the machine; sent messages are logged (development
  only) and kept in `SandboxPushProvider.outbox` (used by tests).
- To try real pushes, set `PUSH_MODE=live` and `FCM_SERVICE_ACCOUNT_JSON` to a Firebase service
  account's JSON, base64-encoded (`node -e "console.log(Buffer.from(require('fs').readFileSync('service-account.json')).toString('base64'))"`).
  Untested against a real Firebase project (D-051) — no account has been created yet.
- The mobile app registers a **raw** FCM device token (`expo-notifications`'
  `getDevicePushTokenAsync()`), not an Expo push token, so this needs a **dev build**
  (`expo run:android`/EAS), not Expo Go, same requirement as the MapLibre map screen. Expo Go
  cannot receive a push through this path.
- iOS push is not wired yet (D-051): an APNs device token needs to be bridged to FCM first.
- A device only receives push once it has signed in on a real build and granted notification
  permission (`PATCH /v1/me/push-token` records the token); the socket connection (Phase 2) still
  covers a foregrounded/recently-backgrounded app regardless.

## Realtime at scale (Phase 5)

- Socket.IO now attaches the Redis adapter at boot (`main.ts`, `realtime/redis-io.adapter.ts`),
  closing D-031: `server.to(room).emit(...)` now reaches every API instance's sockets, not just the
  process that received the request. If Redis can't be reached at boot this falls back to the
  default in-memory adapter (single-instance behaviour) with a logged warning, so it never blocks
  startup.
- Nothing in this runbook yet actually runs more than one API instance — this closes the
  code-level blocker only; load-balancing multiple instances is still a future ops decision.

## Contract labour (Phase 6)

- A job board, not on-demand dispatch: no money moves through the app (D-054). Employers post
  listings (`POST /v1/employer/contracts`, needs the `EMPLOYER` role and a business name set via
  `PATCH /v1/employer/profile` first); Rangers browse (`GET /v1/contracts`) and apply
  (`POST /v1/contracts/:id/apply`), which needs `kycTier >= 1` (the same identity/age gate Rangers
  already go through — D-055, closes COMPLIANCE.md item 7 for this vertical).
- No employer document verification exists (D-056) — anyone can post a listing today. Treat this
  as an MVP trade-off to revisit once there's real usage, not a settled decision.

## Campus (Phase 7)

- Same job-board shape as Contract labour, plus three safeguards: a hard 18+ block (D-060), a
  weekly hours cap across a student's HIRED jobs (default 20h, D-061, tunable via
  `system_config.campus_settings.weekly_hours_cap` without a deploy), and night shifts that
  require both a verified employer and the student's opt-in (D-062).
- A Campus listing needs a **verified** employer — stricter than Contract, which needs none
  (D-056). Verify one via `GET /v1/admin/employers/queue` and `POST
/v1/admin/employers/:id/verify` (needs the `KYC_REVIEWER` admin role; no dedicated admin UI page
  exists yet, D-063 — use `/docs` Swagger UI or a REST client).
- A student sets their date of birth once via `POST /v1/student/profile` (needs the `STUDENT`
  role first); it cannot be resubmitted. This is self-declared, not admin-reviewed against an ID
  the way Ranger KYC is (D-060/D-063).

## Production notes (before any real deployment)

- Set `TRUST_PROXY_HOPS` to the number of proxies in front of the API, or per-IP limits will see the
  load balancer's IP (everyone shares one limit) or, if too high, trust a spoofed header.
- Enable **default encryption** on the KYC bucket and set `S3_SSE=AES256`; keep the bucket private.
- `FIELD_ENCRYPTION_KEY` encrypts DOB and Aadhaar last-4. Back it up separately from the database;
  losing it makes those columns unreadable. Rotation is not implemented yet.
- The public Nominatim/OSM servers must not be used at scale. Use a hosted or self-hosted geocoder.
- Sandbox adapters are refused when `NODE_ENV=production`; payments have no live mode (D-020).

## Troubleshooting

| Symptom                                                        | Cause / fix                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `docker ... dockerDesktopLinuxEngine ... cannot find the file` | Docker Desktop is not running. Start it and wait until it is ready                              |
| `EPERM ... pnpm.CMD` from `corepack enable`                    | Needs admin. Use `npm install -g pnpm@9.15.0` instead                                           |
| `/health/ready` says `degraded`                                | Redis is down. The API still serves; OTP limits fall back to Postgres                           |
| API refuses to start and lists env problems                    | Fix the variables it names (compare with `.env.example`)                                        |
| `FIELD_ENCRYPTION_KEY must be 32 bytes`                        | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`         |
| Photo upload fails on a real phone but works on the emulator   | `S3_PUBLIC_ENDPOINT` still says `localhost`; use the LAN IP                                     |
| Upload returns 403 from storage                                | The file size or Content-Type differs from what was signed; retry the upload                    |
| Admin page redirects to /login immediately                     | Session expired (30 min) or the API is not running on `ADMIN_API_URL`                           |
| Admin images are broken                                        | Set `ADMIN_STORAGE_ORIGIN` (build time) to the storage host used in links                       |
| Sign-in says "Too many attempts"                               | Working as designed: 30 s between codes, 5/hour/phone, 20/hour/IP, lockout after 10 wrong codes |
| Port 5433/6379/9000 already in use                             | Stop the other service or change the mapping in `docker-compose.yml`                            |

## Before launch (ops checklist)

- [ ] Review the seeded DEFAULT price bands per category (placeholders, `sample_size = 0`).
- [ ] Set `tier_bonus_monthly_budget_paise` and `damage_coverage_cap_paise` (both 0 = disabled).
- [ ] Have native speakers review the hi/ta/kn/te translations.
- [ ] Fill `minimum_wage_rules` with counsel-confirmed values (intentionally empty).
- [ ] All four maintenance jobs above are already scheduled (daily cron via `upsertJobScheduler`,
      staggered 02:30-04:00 UTC, see `QueuesService`) whenever `QUEUES_ENABLED=true` (default). What's
      still missing: alerting when one lands in BullMQ's failed-job set (Phase 8 gap).
- [ ] Decide who the KYC reviewers are, and train them on the masked-Aadhaar rule.
- [ ] Review the seeded token bundle prices (`token_bundles`, placeholders) before customers can buy.
- [ ] Review the seeded Haggler Plus plan prices/discount (`plus_plans`, placeholders) and the
      Rush/Boost fee amounts (`system_config.monetization_settings`, placeholders, D-069) before
      launch.
- [ ] Switch `PAYMENTS_MODE` to `test` with real Razorpay TEST keys and a real webhook subscription
      before any non-sandbox testing; there is still no `live` mode anywhere (D-020).
- [ ] Review the badge tier thresholds (`badge-tier.ts::DEFAULT_BADGE_THRESHOLDS`, placeholders);
      override via a `badge_tier_thresholds` row in `system_config` if product/ops want different
      numbers without a deploy.
- [ ] Appoint a real Grievance Officer and update the placeholder name/email/phone shown at
      Legal > Grievance Officer in the app (compliance checklist item 8).
- [ ] Decide on employer verification for Contract labour before launch (D-056) — today any
      account can add the EMPLOYER role and post a listing with no document check. (Campus
      listings already require a human admin to click "verify" — D-062 — but that check is a
      business-name claim, not a registry lookup; decide if that bar is high enough to launch on.)
- [ ] Build an admin UI page for the employer-verification queue (D-063) — today it's REST-only
      (`GET/POST /admin/employers/...`), unlike the KYC queue which has a page in `apps/admin`.
- [ ] Review the Campus weekly hours cap (`campus-config.service.ts::DEFAULT_CAMPUS_SETTINGS`,
      placeholder 20h) and decide if student age verification needs to move from self-declared to
      admin-reviewed (D-060/D-063) before launch.
- [ ] Create a real Firebase project, set `PUSH_MODE=live` and `FCM_SERVICE_ACCOUNT_JSON`, and
      verify a push actually arrives on a dev-build Android phone — `FcmPushProvider` has never
      been exercised against a real Firebase project (D-051).
- [ ] Wire iOS push (APNs token → FCM bridge) before shipping to iOS, or keep iOS push disabled
      and say so in the App Store listing (D-051).
