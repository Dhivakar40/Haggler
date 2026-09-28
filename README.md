# Haggler

A mobile marketplace for India: verified local **Rangers** (independent workers) for on-demand
services, plus long-term contract labour and part-time student jobs, on one trust layer.

> **Status: Phase 0 (Foundation) complete.** Nothing user-facing works end to end yet except
> browsing real service categories and price bands from the API. Sign-in arrives in Phase 1.

## Stack

pnpm monorepo · TypeScript strict · NestJS 11 + Prisma 6 · Postgres 16 + PostGIS · Redis ·
S3-compatible storage · Expo (React Native) + Expo Router + TanStack Query + Zustand + i18next.

## Quick start (from a fresh clone)

Prerequisites: Node 20+ (22 tested), Docker Desktop running, and pnpm 9 (`npm i -g pnpm@9.15.0`).

```bash
pnpm install
cp .env.example apps/api/.env              # PowerShell: Copy-Item .env.example apps/api/.env
pnpm dev:infra                             # Postgres, Redis, MinIO
pnpm build:shared
pnpm db:migrate && pnpm db:seed
pnpm api:dev                               # API on :3000, Swagger UI on /docs
pnpm mobile:start                          # in another terminal; press "a" for Android
```

## Tests

```bash
pnpm test:unit          # shared + api + mobile
pnpm test:integration   # API against real Postgres/PostGIS + Redis (Docker required)
pnpm lint && pnpm typecheck
```

## Docs

[Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Decisions](docs/DECISIONS.md) ·
[Runbook](docs/RUNBOOK.md) · [Compliance](docs/COMPLIANCE.md)

## Terminology

The word "worker" never appears in the UI. The role is **Ranger**. Internally the database and
API keep the name `WORKER` (see [D-003](docs/DECISIONS.md)).

## Adapters: sandbox vs live

Every third-party service (SMS, KYC, payments, calls, push, maps) runs in `sandbox` (fake) or
`live` mode, set by `*_MODE` env vars. The active mode is shown at `/health/ready` and in the
app's Settings screen. Production refuses to boot with any sandbox adapter.
