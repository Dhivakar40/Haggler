# Haggler

A mobile marketplace for India: verified local **Rangers** (independent workers) for on-demand
services, plus long-term contract labour and part-time student jobs, on one trust layer.

> **Status: Phase 9 (Monetization: Haggler Plus, Rush, Boost) complete.** Everything in Phases
> 1–8, plus the platform's first fees beyond the Phase 3 token wallet — all paid by a customer or
> an employer, **never** a Ranger, student, or contract worker (D-036/D-037/D-054/D-062,
> restated and enforced again this phase). Haggler Plus (customer and employer subscription
> tiers: discounted token bundles + priority broadcast for customers, D-070), a customer-paid Rush
> fee to skip wave sequencing on one request (D-071), and an employer-paid Boosted Listing fee for
> higher placement of one Contract/Campus listing (D-072) — all three wired through the existing
> customer-wallet/Razorpay-test-mode pipeline from Phase 3, one payment pipeline with four
> purposes rather than four separate payment systems (D-069).
>
> Phase 8 added admin moderation: a `DISPUTE_AGENT`-gated admin can hide a fraudulent/abusive
> review (reversing its rating out of the reviewee's stats, D-064) and take down a
> fraudulent/abusive Contract or Campus listing (D-065), both with an `apps/admin` UI page, not
> just REST endpoints. Phase 7's Campus vertical: a Student (a new light role) browses part-time
> listings a verified Employer posts and applies, with three required safeguards — a hard 18+
> block (self-declared, enforced in code, not admin-reviewed — D-060), a weekly hours cap checked
> at both apply and hire (default 20h, D-061), and night shifts that need both a verified employer
> and the student's explicit opt-in (D-062). **No money moves through the app for Campus or
> Contract labour job payment** — the employer pays the worker directly (D-037/D-054/D-062).
> **Rangers, students and contract workers are still never charged anything, at any tier**
> (D-037, unchanged since Phase 3, restated for Phase 9's monetization by D-069).

## Stack

pnpm monorepo · TypeScript strict · NestJS 11 + Prisma 6 · Postgres 16 + PostGIS · Redis ·
S3-compatible storage · Expo (React Native) + Expo Router + TanStack Query + Zustand + i18next ·
Next.js (admin).

| Path              | What                                                 |
| ----------------- | ---------------------------------------------------- |
| `apps/api`        | REST API (NestJS)                                    |
| `apps/mobile`     | Expo app: customers and Rangers                      |
| `apps/admin`      | Next.js admin console (KYC review queue)             |
| `packages/shared` | zod schemas, types and constants shared by all three |

## Quick start (from a fresh clone)

Prerequisites: Node 20+ (22 tested), Docker Desktop running, pnpm 9 (`npm i -g pnpm@9.15.0`).

```bash
pnpm install
cp .env.example apps/api/.env              # PowerShell: Copy-Item .env.example apps/api/.env
pnpm dev:infra                             # Postgres, Redis, MinIO
pnpm build:shared
pnpm db:migrate && pnpm db:seed
pnpm api:dev                               # API on :3000, Swagger UI on /docs
pnpm mobile:start                          # another terminal; press "a" for Android
```

**Signing in during development:** the SMS adapter is a sandbox. Request a code in the app, then
read it from the API console (`[SANDBOX SMS] OTP for +91...: 123456`). No SMS is sent.

**Admin console:**

```bash
ADMIN_PASSWORD='choose-a-long-passphrase' pnpm --filter @haggler/api admin:create \
    --email you@example.com --name "Your Name" --roles KYC_REVIEWER
pnpm admin:dev                             # http://localhost:3001
```

## Tests

```bash
pnpm test:unit          # shared + api + mobile + admin
pnpm test:integration   # API against real Postgres/PostGIS, Redis and MinIO (Docker required)
pnpm lint && pnpm typecheck
```

## Docs

[Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Decisions](docs/DECISIONS.md) ·
[Runbook](docs/RUNBOOK.md) · [Compliance](docs/COMPLIANCE.md)

## Terminology

The word "worker" never appears in the UI. The role is **Ranger**. Internally the database and
API keep the name `WORKER` (see [D-003](docs/DECISIONS.md)).

## Adapters: what is real and what is a stand-in

| Adapter  | Modes              | Today                                                                                                                                                      |
| -------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SMS      | `sandbox` / `live` | Sandbox. The MSG91 adapter exists but is **untested** against MSG91                                                                                        |
| KYC      | `manual_admin`     | Humans review documents. No automated eKYC/face-match/background check                                                                                     |
| Payments | `sandbox` / `test` | Razorpay **test keys only** (no live mode); mobile Checkout UI only wired up for `sandbox`                                                                 |
| Calls    | `disabled`         | Masked calling is not built; in-app chat only (built in Phase 2)                                                                                           |
| Push     | `sandbox` / `live` | Sandbox by default. `live` calls Firebase (FCM) directly with a raw device token (Android; iOS not wired, D-051). Untested against a real Firebase project |
| Maps     | `sandbox` / `osm`  | OpenStreetMap + MapLibre; public tile server is dev-only (needs a dev build, not Expo Go, to render natively)                                              |

The active modes show at `/health/ready` and in the app's Settings. Production refuses to boot
with a sandbox adapter.
