# Runbook (Phase 0: local development)

## Start everything

```bash
pnpm install
cp .env.example apps/api/.env          # PowerShell: Copy-Item .env.example apps/api/.env
pnpm dev:infra                         # Postgres+PostGIS :5433, Redis :6379, MinIO :9000/:9001
pnpm build:shared
pnpm db:migrate && pnpm db:seed
pnpm api:dev                           # http://localhost:3000  (docs UI at /docs)
pnpm mobile:start                      # Expo dev server
```

Physical phone: set `EXPO_PUBLIC_API_URL=http://<your PC LAN IP>:3000` in `apps/mobile/.env`.
Android emulator reaches your PC at `10.0.2.2` automatically.

## Checks

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test:unit
pnpm test:integration     # needs Docker running; spins up throw-away containers
pnpm openapi              # regenerates docs/openapi.json and docs/API.md
```

## Reset the local database

```bash
docker compose down -v    # deletes the volumes (all local data)
pnpm dev:infra && pnpm db:migrate && pnpm db:seed
```

## Troubleshooting

| Symptom                                                             | Cause / fix                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `docker ... dockerDesktopLinuxEngine ... cannot find the file`      | Docker Desktop is not running. Start it and wait for the whale to go steady |
| `EPERM ... pnpm.CMD` from `corepack enable`                         | Needs admin. Use `npm install -g pnpm@9.15.0` instead                       |
| `/health/ready` says `degraded`                                     | Redis is down. API still serves; check `docker compose ps`                  |
| API refuses to start, lists env problems                            | Fix the variables it names; `apps/api/.env` vs `.env.example`               |
| API refuses to start: `*_MODE=sandbox is not allowed in production` | Intended (D-012). Provide live credentials and set the mode to `live`       |
| Port 5433/6379/9000 already in use                                  | Stop the other service or change the mapping in `docker-compose.yml`        |
| Mobile can't reach API on a phone                                   | Set `EXPO_PUBLIC_API_URL` to your LAN IP; allow port 3000 in the firewall   |

## Before launch (ops checklist started in Phase 0)

- [ ] Review the seeded DEFAULT price bands per category (placeholders, `sample_size = 0`).
- [ ] Set `tier_bonus_monthly_budget_paise` and `damage_coverage_cap_paise` (both 0 = disabled).
- [ ] Have a native speaker review the hi/ta/kn/te translations.
- [ ] Fill `minimum_wage_rules` with counsel-confirmed values (intentionally empty).
