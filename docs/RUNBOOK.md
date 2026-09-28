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

## Scheduled jobs (run daily until BullMQ arrives in Phase 2)

```bash
pnpm --filter @haggler/api job purge-accounts     # anonymise accounts whose 30-day deletion grace ended
pnpm --filter @haggler/api job purge-kyc-images   # delete identity images past kyc_image_retention_days (30)
```

Both are idempotent. If they never run, the retention promises in COMPLIANCE.md are **not** kept.

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
- [ ] Schedule the two daily jobs above and alert if they fail.
- [ ] Decide who the KYC reviewers are, and train them on the masked-Aadhaar rule.
