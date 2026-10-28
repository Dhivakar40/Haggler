# 11 — Handover

> Source: `README.md` (read in full — it already documents the from-scratch quick start),
> `docs/RUNBOOK.md`'s "One-time setup" and "Rotating secrets later" sections (read in full), this
> session's own direct actions (pushing to GitHub, running a production migration, triggering an
> EAS build).

## Running everything from scratch on a new machine

Prerequisites: Node 20+ (22 tested), Docker Desktop **running**, pnpm 9
(`npm i -g pnpm@9.15.0`).

```bash
pnpm install
cp .env.example apps/api/.env              # PowerShell: Copy-Item .env.example apps/api/.env
pnpm dev:infra                             # starts local Postgres+PostGIS, Redis, MinIO via Docker Compose
pnpm build:shared
pnpm db:migrate && pnpm db:seed
pnpm api:dev                               # API on :3000, Swagger UI on /docs
pnpm mobile:start                          # separate terminal; press "a" for Android (emulator or device)
```

Signing in during local development: the SMS adapter is sandboxed — request a code in the app,
then read it from the API's console log (`[SANDBOX SMS] OTP for +91...: 123456`). No real SMS is
sent locally.

**Admin console:**
```bash
ADMIN_PASSWORD='choose-a-long-passphrase' pnpm --filter @haggler/api admin:create \
    --email you@example.com --name "Your Name" --roles KYC_REVIEWER
pnpm admin:dev                             # http://localhost:3001
```

**Tests:**
```bash
pnpm test:unit          # shared + api + mobile + admin (no Docker needed)
pnpm test:integration   # API e2e against real Postgres/PostGIS, Redis and MinIO — Docker required
pnpm lint && pnpm typecheck
pnpm format:check        # currently fails on 95 files repo-wide as of this session — see 08-quality-and-testing.md
```

## Building the APK

This session's own steps, verbatim (the second line is the one that actually worked — the first
attempt failed on an `npx` resolution quirk worth knowing about):

```bash
cd apps/mobile
npx eas build --platform android --profile preview --non-interactive
# ^ FAILS: "npm error could not determine executable to run" — npx can't resolve bare "eas"
npx eas-cli build --platform android --profile preview --non-interactive
# ^ WORKS — installs eas-cli@<latest> on first run, then builds
```

The build profile used is `preview` (`apps/mobile/eas.json`): `distribution: internal`,
`android.buildType: apk`, with `EXPO_PUBLIC_API_URL` baked in from the profile's `env` block
(currently `https://haggler-f.onrender.com`). Progress and the final APK download link appear at
**expo.dev → your account → the Haggler project → Builds**. EAS Build's free tier caps at **15
Android builds/month** (`docs/RUNBOOK.md:284`).

If this is a genuinely new machine (no Expo account linked yet), `docs/RUNBOOK.md:305-307` covers
the one-time `eas login` / `eas init` steps (creates `expo.extra.eas.projectId` in `app.json`).

## Deploying a backend change

1. `git push origin main`.
2. **Manually trigger a deploy on Render** — this session confirmed auto-deploy-on-push is **not**
   currently configured on the `haggler-f` service, despite `RUNBOOK.md:381` describing it as if
   it were. Open the Render dashboard → `Haggler-f` service → trigger the deploy by hand.
3. If the change included a new Prisma migration, run it against production **after** the deploy
   is live. This session did this directly from a local machine (no Render Shell access on the
   free plan — Shell requires the paid Starter tier):
   ```bash
   cd apps/api
   DATABASE_URL='<the production Supabase session-pooler URL>' npx prisma migrate deploy
   ```
   This only applies pending migrations (additive, idempotent) — safe to run any time, not just
   right after a deploy.
4. Verify by checking `_prisma_migrations` in Supabase's own SQL Editor (no local tooling
   needed): `SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 5;`

## One-time account setup for a brand-new deployment (from `docs/RUNBOOK.md:286-307`)

If starting completely fresh (not just redeploying the existing `haggler-f` stack):

1. **Supabase**: new project → enable the `postgis` extension → copy the **Session pooler**
   connection string (port 5432, not the 6543 transaction pooler — Prisma's interactive
   transactions reproduced real `P2028` failures against the transaction pooler earlier in this
   project) → that's `DATABASE_URL`.
2. **Upstash**: new Redis database → copy the `rediss://` connection string → `REDIS_URL`.
3. **Backblaze B2**: new account (no card needed) → two buckets → an Application Key (not the
   master key) scoped to both, read+write → `S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_REGION`.
4. **Render**: new free Web Service from this repo, root directory `apps/api`, build command
   `pnpm install --frozen-lockfile && pnpm build:shared && pnpm --filter @haggler/api build`,
   start command `pnpm --filter @haggler/api start:prod` (or equivalent).
5. **Expo/EAS**: `eas login`, then `eas init` in `apps/mobile` once to link the project.

**Important operational fact about the *existing* `haggler-f` deployment** (not a fresh-setup
step, but essential to know before touching it): `RUNBOOK.md:326-329` states `NODE_ENV` is
deliberately left at its default (`development`) on this service, specifically so
`TESTING_MODE=true` continues to work there — `env.ts` refuses `TESTING_MODE=true` only when
`NODE_ENV=production`. This means the live backend the current APK points at is, by design, not
running in the API's own "production" mode, and the fixed-code OTP testing bypass is live and
reachable on it today. See `07-trust-safety-security.md` for the full implication.

## Where each secret/account lives (names only)

| Secret / account | Lives at | Who owns it (from this session) |
|---|---|---|
| GitHub repo | `github.com/Dhivakar40/Haggler` | The user (`Dhivakar40`) |
| Render account, services `Haggler-f`/`Haggler-admin`/`Haggler`/`squad-io-backend` | render.com, org "Dhivakar40's Org" (Free plan) | The user |
| Supabase project (`haggler_f`, ap-south-1/Mumbai) | supabase.com | The user — this session read its `DATABASE_URL` directly off the Render `haggler-f` service's Environment tab |
| Upstash Redis | upstash.com | UNKNOWN account owner — not accessed this session, only referenced via `docs/RUNBOOK.md` |
| Backblaze B2 storage | backblaze.com | UNKNOWN account owner — not accessed this session |
| Expo/EAS account | expo.dev | The user — this session's build ran under whatever account this machine's `eas-cli` session is logged into |
| `JWT_ACCESS_SECRET`, `ADMIN_JWT_SECRET`, `FIELD_ENCRYPTION_KEY` | Render environment variables (`haggler-f`) | Per `docs/RUNBOOK.md:333-336`, these — along with the B2 storage keys — are **still the values that were pasted in plaintext chat** earlier in this project's history and were flagged there as needing rotation; not independently re-verified as rotated or not in this session |
| Database password | Supabase project settings | **This session's own chat transcript contains the live production database password**, pasted by the user while diagnosing which backend pointed at which database. This was flagged in-conversation at the time; repeating it here as a handover item — **rotate this password via the Supabase dashboard**, since anyone with access to this conversation's history now has it |

## What must be kept paying for or renewed

Per `03-architecture-and-stack.md`: **everything is currently on a free tier** — Supabase (500 MB,
auto-pauses after 7 days idle), Upstash (500K commands/mo), Backblaze B2 (10 GB), Render (free web
service, cold-starts after 15 min idle), EAS Build (15 Android builds/month). None of these are
being paid for today; all would need a paid-tier upgrade before a real launch at any meaningful
scale, and the Supabase project specifically needs a manual "restore" click in its dashboard if it
has ever auto-paused from a week of inactivity (worth checking first if anything seems down after
a gap).
