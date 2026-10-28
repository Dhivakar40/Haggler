# 05 — API and Realtime

> Source: every `*.controller.ts` in `apps/api/src` (16 files, read via decorator-level grep, not
> re-derived), `packages/shared/src/marketplace-schemas.ts` (`SOCKET_EVENTS`),
> `apps/api/src/maintenance/queues.service.ts`, `apps/api/src/marketplace/scheduler.service.ts`,
> and every file under `apps/api/src/adapters/`.

## Endpoint count

```
grep -rE "@(Get|Post|Patch|Put|Delete)\(" apps/api/src --include="*.controller.ts" | wc -l
```
→ **175 route decorators** across **16 controller files**. (A controller class can declare more
than one `@Controller()` path prefix per file — several files below hold 2-4 logical route groups.)

## Every endpoint, by module

Role column is inferred from the guard/decorator pattern seen in each controller (`CurrentUser`,
admin JWT guard, or `@Public`/unauthenticated) — see each controller file for the exact guard.
Not independently re-verified per-route against the actual guard decorator in this pass; treat the
Role column as a strong inference from the controller's own grouping and file location, not a
line-by-line audit.

### Auth (`apps/api/src/auth/auth.controller.ts`) — public
`POST /v1/auth/otp/send`, `POST /v1/auth/otp/verify`, `POST /v1/auth/refresh`,
`POST /v1/auth/logout`.

### Me / account (`users/users.controller.ts`) — signed-in user
`GET /v1/me/league`, `GET /v1/me`, `POST /v1/me/onboarding`, `PATCH /v1/me`,
`PATCH /v1/me/push-token`, `DELETE /v1/me/push-token`, `POST /v1/me/roles`,
`GET /v1/me/consents`, `POST /v1/me/consents`, `DELETE /v1/me/consents/:purpose`,
`GET /v1/me/export`, `DELETE /v1/me` (request deletion), `POST /v1/me/cancel-deletion`,
`GET/POST/PATCH/DELETE /v1/me/addresses[/:id]`,
`GET/POST/PATCH/DELETE /v1/me/emergency-contacts[/:id]`.

### KYC (`kyc/kyc.controller.ts`) — signed-in user
`POST /v1/kyc/start`, `POST /v1/kyc/documents`, `POST /v1/kyc/documents/:id/confirm`,
`POST /v1/kyc/submit`, `GET /v1/kyc/status`.

### Catalog, public (`catalog/catalog.controller.ts`) — public/signed-in
`GET /v1/categories`, `GET /v1/price-bands`, `GET /v1/price-list`,
`GET /v1/price-list/add-ons`.

### Worker presence & league (`marketplace/worker-presence.controller.ts`) — Ranger
`GET /v1/worker/league`, `POST /v1/worker/online`, `POST /v1/worker/offline`,
`GET /v1/worker/presence`, `POST /v1/worker/location`, `GET /v1/worker/incoming`.

### Worker profile (`worker/worker.controller.ts`) — Ranger
`GET /v1/worker/profile`, `PATCH /v1/worker/profile`.

### Requests & the on-demand job lifecycle (`marketplace/requests.controller.ts`) — the largest
single controller, **three** route groups:
- `requests` (Customer): `POST /v1/requests/media`,
  `POST /v1/requests/media/:mediaId/confirm`, `POST /v1/requests` (create),
  `GET /v1/requests/:id`, `POST /v1/requests/:id/cancel`, `.../rebroadcast`, `.../rush`,
  `.../accept`, `.../decline`.
- `jobs` (Customer + Ranger, 34 routes) — the full state-machine surface described in
  `02-job-flow-and-money.md`: list/get, quotes (propose/withdraw/accept/decline — the legacy
  negotiation path), en-route, arrive, verify-arrival, arrive/regenerate, photos (+confirm),
  start, complete, confirm, payment/online, cancel, report-no-show, reassign, sos,
  incident-reports, dispute, the **new** quote-first path (`quote`, `quote/accept`,
  `quote/reject`), the parts-pause path (`pause`, `pause/resume`, `pause/reject`,
  `pause/unavailable`, `pause/settlement`, `pause/wait`), item handovers (+sign-off), `track`,
  `share-link` (+revoke), `thread`, and mid-job add-ons (propose/approve/decline).
- `threads` (Customer + Ranger, chat): `GET /v1/threads/:id/messages`,
  `POST /v1/threads/:id/messages`.

### Public tracking (`marketplace/public-track.controller.ts`) — public, token-gated
`GET /v1/track/:token`, `GET /t/:token` (version-neutral — a shareable live-tracking link for a
trusted contact who isn't a Haggler user).

### Reputation / reviews / blocks (`reputation/reputation.controller.ts`) — signed-in user
`POST /v1/jobs/:id/review`, `GET /v1/jobs/:id/reviews`, `GET /v1/rangers/:id/reviews`,
`GET/POST /v1/me/blocks`, `DELETE /v1/me/blocks/:userId`.

### Haggler Plus (`monetization/plus.controller.ts`) — signed-in user
`GET /v1/plus/plans`, `GET /v1/plus/membership`.

### Customer Wallet & payments (`wallet/wallet.controller.ts`) — signed-in user + one public webhook
`GET /v1/wallet`, `GET /v1/wallet/bundles`, `GET /v1/wallet/orders`,
`POST /v1/wallet/topup`, `POST /v1/wallet/plus/subscribe`,
`POST /v1/wallet/orders/:orderId/verify`, `POST /v1/wallet/orders/:orderId/sandbox-pay`,
and `POST /v1/webhooks/razorpay` (Razorpay's own server calls this, HMAC-verified, no user auth).
**Note**: `bundles`/`topup` are the token-purchase endpoints whose mobile UI was removed this
session (D-106) — still live and callable, just not linked from the app anymore.

### Worker Wallet (`wallet/worker-wallet.controller.ts`) — Ranger
`GET /v1/worker/wallet`, `POST /v1/worker/wallet/dues/settle`,
`POST /v1/worker/wallet/withdraw`.

### Contracts (`contracts/contracts.controller.ts`) — Employer + Ranger, three route groups
`GET/PATCH /v1/employer/profile`; `POST/GET/PATCH /v1/employer/contracts[/:id]`,
`.../applications`, `.../boost`, `.../applications/:appId/decision`; public browse
`GET /v1/contracts`, `GET /v1/contracts/:id`, `POST/DELETE /v1/contracts/:id/apply`;
`GET /v1/me/contract-applications`.

### Campus (`campus/campus.controller.ts`) — Employer + Student, four route groups
`GET/POST/PATCH /v1/student/profile`; employer side
`POST/GET/PATCH /v1/employer/campus[/:id]`, `.../applications`, `.../boost`,
`.../applications/:appId/decision`; public browse `GET /v1/campus`, `GET /v1/campus/:id`,
`POST/DELETE /v1/campus/:id/apply`; `GET /v1/me/campus-applications`.

### Health (`health/health.controller.ts`) — public, version-neutral
`GET /health/live`, `GET /health/ready`.

### Admin (`admin/admin.controller.ts`) — Admin JWT audience only, separate from user auth
`POST /v1/admin/auth/login`, `GET /v1/admin/me`; KYC queue (`GET kyc/queue`, `GET kyc/:id`,
`POST kyc/:id/decision`); employer verification queue; review moderation
(`GET reviews`, `POST reviews/:id/hide`); SOS queue (`GET sos`, `POST sos/:id/resolve`);
disputes (`GET disputes`, `POST disputes/:id/resolve`); incident reports
(`GET incident-reports[/:id/evidence]`, `POST .../resolve`); fraud review
(`GET fraud-review`, `POST fraud-review/:id/resolve`,
`GET fraud-review/multi-account-candidates`); "other"-job moderation
(`GET other-jobs`, `POST other-jobs/:id/cancel`); contract/campus listing moderation
(`GET/POST .../cancel` for each); runtime config (`GET config`, `POST config/:key` — this is the
`SystemConfig` table every flag/fee/tunable in this report ultimately comes from); price list
management (`GET/POST price-list[/add-ons]`); category inspection charge
(`POST categories/:id/inspection-charge`).

## Socket events (`packages/shared/src/marketplace-schemas.ts:562-572`, `SOCKET_EVENTS`)

| Event | Purpose |
|---|---|
| `request.broadcast` | A new on-demand request pushed to nearby eligible Rangers |
| `request.taken` | Tells other Rangers in the same broadcast wave the job is gone |
| `request.matched` | Customer notified a Ranger accepted |
| `request.timeout` | A broadcast wave expired with no taker |
| `job.updated` | Generic job-state-changed push (covers most of the state machine in `02-job-flow-and-money.md`) |
| `offer.updated` | Legacy negotiation offer changed |
| `location.update` | Live GPS ping during an active job |
| `chat.message` | New chat message on a job's thread |
| `request.accept` | A Ranger's accept action, mirrored to the customer in real time |

## Background jobs and schedulers

Two separate mechanisms, gated independently by `QUEUES_ENABLED` and `SCHEDULER_ENABLED` (both
default `true`):

**BullMQ cron jobs** (`apps/api/src/maintenance/queues.service.ts:7-11`, Redis-backed, run
regardless of instance count if Redis is shared):

| Job | Schedule (cron) | Purpose (inferred from name; `MaintenanceService.run()` not read in this pass) |
|---|---|---|
| `purge-accounts` | `30 2 * * *` (02:30 daily) | Anonymises accounts past their deletion grace period — see `AccountLifecycleService.purgeDueDeletions()` in `01`/`09` |
| `purge-kyc-images` | `0 3 * * *` (03:00 daily) | Deletes stored KYC document files past retention |
| `trim-auth-data` | `30 3 * * *` (03:30 daily) | Expired OTP attempts / stale refresh tokens cleanup |
| `trim-gps-trails` | `0 4 * * *` (04:00 daily) | Old `JobLocation` ping rows cleanup |

**In-process scheduler** (`apps/api/src/marketplace/scheduler.service.ts`): a plain
`setInterval` ticking every 2 seconds (not BullMQ — runs per-instance, which is fine today since
production is a single Render instance, per `03-architecture-and-stack.md`'s `THROTTLE_STORE`
reasoning, but would double-fire if ever scaled to 2+ instances without being moved to a shared
job). It flags overdue parts-pauses and cancels stale `timed_out` jobs.

## Third-party integrations: live vs sandbox adapter, per vendor

Every vendor uses the same adapter pattern (`docs/ARCHITECTURE.md:36-40`): one interface, a
sandbox implementation, and a live implementation picked at runtime by a `*_MODE` env var.

| Vendor area | Sandbox class | Live class | Live vendor identity | Status |
|---|---|---|---|---|
| SMS | `SandboxSmsProvider` (in-memory outbox) | `Msg91SmsProvider` | Msg91 | **Live adapter exists and is implemented** (`sms/sms.provider.ts:49`) |
| Payments | `SandboxPaymentsProvider` (real HMAC signing, no money moves) | `RazorpayPaymentsProvider` | Razorpay | Live adapter exists, but **only `rzp_test_...` test keys are accepted by `env.ts`** — a real live Razorpay key is refused at boot (D-020). So even in "live" `PAYMENTS_MODE`, no real money can currently move |
| Push notifications | `SandboxPushProvider` (in-memory outbox) | `FcmPushProvider` | Firebase Cloud Messaging, direct (not Expo's push relay, D-051) | Live adapter exists |
| Maps / geocoding | `SandboxMapsProvider` (no geocoding; trusts device GPS) | `NominatimMapsProvider` | Nominatim (OpenStreetMap) | Live adapter exists |
| Email (OTP fallback) | Sandbox (console-logs in dev only) | `SmtpEmailProvider` (plain nodemailer, any SMTP account) | Provider-agnostic SMTP; Gmail app-password recommended in `RUNBOOK.md` as the free option | Live adapter exists |
| Masked calls | — | — | **none** | **NOT BUILT** — `CallProvider` is an interface only, no implementation exists (code comment: "D-019"); `CALLS_MODE` is **pinned to `disabled`**, not even a real sandbox toggle (`apps/api/src/adapters/calls/call.provider.ts:1-15`) |
| KYC | — | `ManualAdminKycProvider` | — | Single implementation: **manual human review only**. No automated face-matching or document-verification vendor integration exists (`apps/api/src/adapters/kyc/kyc.provider.ts`) — see `01-overview-and-status.md`'s NOT BUILT row and `07-trust-safety-security.md` |
