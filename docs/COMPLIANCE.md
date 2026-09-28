# Compliance (living document)

> **Not legal advice and not legal sign-off.** This file records the _mechanisms_ the product
> implements and the items counsel must confirm before launch. Every "Status" below refers to
> engineering work only.

## Counsel review checklist

| #   | Item                                                                        | Engineering status                                        | Counsel |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------- | ------- |
| 1   | DPDP Act: consent screens, purpose limitation, retention, deletion + export | Phase 1 (consent, deletion/export); retention table below | ☐       |
| 2   | Aadhaar: store only reference token + last 4 digits, never the full number  | Phase 1 (KYC); log redaction already in place (Phase 0)   | ☐       |
| 3   | Independent-contractor Terms of Service for Rangers                         | Placeholder screens Phase 1                               | ☐       |
| 4   | Terms of Service, Privacy Policy, Refund Policy text                        | Placeholder text, marked "needs counsel review"           | ☐       |
| 5   | TDS, GST, invoicing rules for platform fees and payouts                     | Phase 3                                                   | ☐       |
| 6   | Minimum wage by state and trade                                             | Table exists, **empty on purpose**; counsel must supply   | ☐       |
| 7   | Child labour: hard block under 18 (Contracts + Campus)                      | Phases 6-7                                                | ☐       |
| 8   | Grievance officer name/contact shown in-app                                 | Phase 4                                                   | ☐       |
| 9   | Damage coverage cap and insurer                                             | Config `damage_coverage_cap_paise` = 0 (disabled)         | ☐       |
| 10  | Translations (hi/ta/kn/te) legally accurate where they carry legal text     | Drafts; native review needed                              | ☐       |

## Implemented in Phase 0

- **Secrets and Aadhaar never logged.** Pino redacts authorization, cookies, idempotency keys,
  `otp`, `code`, `password`, `aadhaar`, `aadhaarNumber`, `refreshToken` (`LOG_REDACT_PATHS`).
- **Refresh tokens stored hashed** (`refresh_tokens.token_hash`); OTP codes stored hashed.
- **Audit log is append-only** (DB trigger rejects UPDATE/DELETE); tested.
- **Sandbox adapters cannot run in production** (D-012).
- **Phone numbers validated to E.164** at the DB level.

## Retention schedule (draft, for counsel to confirm)

| Table(s)               | Contents                    | Retention                                        | Basis / note                       |
| ---------------------- | --------------------------- | ------------------------------------------------ | ---------------------------------- |
| `users`, `user_roles`  | Account identity            | Life of account + 30 days after deletion request | Deletion flow anonymises (Phase 1) |
| `otp_attempts`         | Hashed OTP, phone, IP       | 30 days                                          | Abuse investigation only           |
| `refresh_tokens`       | Hashed session tokens       | Until expiry/revocation + 30 days                | Security forensics                 |
| `devices`              | Device id, push token       | Life of account                                  | Deleted with the account           |
| `addresses`            | Saved addresses + geo point | Life of account                                  | Deleted with the account           |
| `audit_logs`           | Admin/system actions        | 7 years (proposed)                               | **Immutable; counsel to confirm**  |
| `price_bands`, catalog | Non-personal reference data | Indefinite                                       | Not personal data                  |
| `minimum_wage_rules`   | Legal reference data        | Indefinite, versioned by `effective_from`        | Counsel-confirmed values only      |

Later phases append their tables here (KYC documents, GPS trails, chat, payments, etc.).
