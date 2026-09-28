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
