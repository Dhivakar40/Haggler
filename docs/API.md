# Haggler API

> Generated from the code by `pnpm openapi`. Do not edit by hand; CI fails if it drifts.
> Machine-readable spec: [openapi.json](./openapi.json). Live UI at `/docs` when the API runs.

| Method | Path | Summary |
| --- | --- | --- |
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe; also reports which adapters are sandbox vs live |
| POST | `/v1/admin/auth/login` | Admin sign-in (email + password). 5 wrong attempts per email locks it for 15 minutes. |
| GET | `/v1/admin/kyc/{id}` | One verification with short-lived image links. Each view is audit-logged. |
| POST | `/v1/admin/kyc/{id}/decision` | Approve, reject (reason required) or request more information |
| GET | `/v1/admin/kyc/queue` | KYC review queue, oldest first, cursor-paginated |
| GET | `/v1/admin/me` | Who am I (admin) |
| POST | `/v1/auth/logout` | End this session (revokes the refresh token family). Always succeeds. |
| POST | `/v1/auth/otp/send` | Send a 6-digit code by SMS. Limits: 30 s between codes, 5/hour per phone, 20/hour per IP. |
| POST | `/v1/auth/otp/verify` | Verify the code. Creates the account on first sign-in and returns a session. |
| POST | `/v1/auth/refresh` | Exchange a refresh token for a new pair. The old refresh token stops working. |
| GET | `/v1/categories` | List active service categories (public) |
| POST | `/v1/kyc/documents` | Get a presigned URL (valid 5 min) to upload one document straight to private storage |
| POST | `/v1/kyc/documents/{id}/confirm` | Confirm that the upload finished; verifies the file exists at the declared size |
| POST | `/v1/kyc/start` | Open a tier 1 (identity) or tier 2 (go-live) verification. Needs KYC consent. |
| GET | `/v1/kyc/status` | My verification tier and the state of each check, including reviewer messages |
| POST | `/v1/kyc/submit` | Submit the verification for admin review (tier 2 also needs a reference) |
| GET | `/v1/me` | My account, roles and any consents I still need to give |
| PATCH | `/v1/me` | Update my name and languages |
| DELETE | `/v1/me` | Request account deletion. Sessions end now; data is erased after a 30-day grace period. |
| GET | `/v1/me/addresses` | My saved addresses |
| POST | `/v1/me/addresses` | Save an address. Send latitude+longitude from the phone GPS, or we try to geocode it. |
| PATCH | `/v1/me/addresses/{id}` | Edit one of my addresses |
| DELETE | `/v1/me/addresses/{id}` | Delete one of my addresses |
| GET | `/v1/me/consents` | My consent history |
| POST | `/v1/me/consents` | Give consent for a purpose at the current legal version |
| DELETE | `/v1/me/consents/{purpose}` | Withdraw consent for a purpose |
| GET | `/v1/me/emergency-contacts` | My emergency contacts (used by SOS and live-trip sharing) |
| POST | `/v1/me/emergency-contacts` | Add an emergency contact (max 5) |
| PATCH | `/v1/me/emergency-contacts/{id}` | Edit an emergency contact |
| DELETE | `/v1/me/emergency-contacts/{id}` | Remove an emergency contact |
| GET | `/v1/me/export` | Download all data we hold about me (DPDP access right) |
| POST | `/v1/me/roles` | Add a role (Customer, Ranger or Employer). Student arrives with Haggler Campus. |
| GET | `/v1/price-bands` | Price band (min/median/max, integer paise) for a category and area |
| GET | `/v1/worker/profile` | My Ranger profile (verification tier, categories, bio) |
| PATCH | `/v1/worker/profile` | Update my Ranger profile and the categories I work in (max 5) |
