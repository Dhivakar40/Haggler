# Haggler

A mobile marketplace for India: verified local **Rangers** (independent workers) for on-demand
services, plus long-term contract labour and part-time student jobs, on one trust layer.

> **Status: Phase 7 (Campus) complete.** Everything in Phases 1–6, plus the second job-board
> vertical: a Student (a new light role) browses part-time listings a verified Employer posts and
> applies. Three safeguards the original spec required, on top of Phase 6's mechanics: a hard
> 18+ block (self-declared, enforced in code, not admin-reviewed — D-060), a weekly hours cap
> checked at both apply and hire (default 20h, D-061), and night shifts that need both a verified
> employer and the student's explicit opt-in (D-062). **No money moves through the app for
> Campus, same as Contract labour** — the employer pays the student directly (D-037/D-054/D-062).
> **Rangers are still never charged anything** (D-037, unchanged since Phase 3).

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
