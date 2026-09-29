# Haggler

A mobile marketplace for India: verified local **Rangers** (independent workers) for on-demand
services, plus long-term contract labour and part-time student jobs, on one trust layer.

> **Status: Phase 3 (Customer Wallet & Payments) complete.** Everything in Phases 1–2, plus: a
> customer buys token bundles via Razorpay (test mode) into a wallet, one token is reserved the
> moment they post a request and permanently spent only once the job is confirmed complete (given
> back if the job is cancelled or a no-show). **Rangers are never charged anything** — the
> cash/UPI-direct payment between customer and Ranger from Phase 2 is completely unchanged; the
> wallet exists purely for the customer/employer side. Reputation/badges beyond the raw
> jobs-completed count start in Phase 4.

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

| Adapter  | Modes              | Today                                                                                                         |
| -------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| SMS      | `sandbox` / `live` | Sandbox. The MSG91 adapter exists but is **untested** against MSG91                                           |
| KYC      | `manual_admin`     | Humans review documents. No automated eKYC/face-match/background check                                        |
| Payments | `sandbox` / `test` | Razorpay **test keys only** (no live mode); mobile Checkout UI only wired up for `sandbox`                    |
| Calls    | `disabled`         | Masked calling is not built; in-app chat only (built in Phase 2)                                              |
| Push     | `sandbox` / `live` | Sandbox until Phase 5 — a Ranger must have the app open to see requests                                       |
| Maps     | `sandbox` / `osm`  | OpenStreetMap + MapLibre; public tile server is dev-only (needs a dev build, not Expo Go, to render natively) |

The active modes show at `/health/ready` and in the app's Settings. Production refuses to boot
with a sandbox adapter.
