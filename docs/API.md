# Haggler API

> Generated from the code by `pnpm openapi`. Do not edit by hand; CI fails if it drifts.
> Machine-readable spec: [openapi.json](./openapi.json). Live UI at `/docs` when the API runs.

| Method | Path | Summary |
| --- | --- | --- |
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe; also reports which adapters are sandbox vs live |
| GET | `/v1/categories` | List active service categories (public) |
| GET | `/v1/price-bands` | Price band (min/median/max, integer paise) for a category and area |
