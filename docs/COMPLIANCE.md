# Compliance (living document)

> **Not legal advice and not legal sign-off.** This file records the _mechanisms_ the product
> implements and the items counsel must confirm before launch. Every "Status" below refers to
> engineering work only.

## Counsel review checklist

| #   | Item                                                                          | Engineering status                                                                      | Counsel |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------- |
| 1   | DPDP: explicit consent, purpose limitation, retention, deletion + export      | **Built (Phase 1)**: consent screen, versioned consent records, export, 30-day deletion | ☐       |
| 2   | Aadhaar: never store the full number; masked copy only                        | **Partly**: see "Aadhaar handling" below. Relies on users uploading the masked copy     | ☐       |
| 3   | Independent-contractor Terms of Service for Rangers                           | Placeholder screens only                                                                | ☐       |
| 4   | Terms of Service, Privacy Policy, Refund Policy text                          | Placeholder text, marked in the app "needs counsel review"                              | ☐       |
| 5   | TDS, GST, invoicing rules for platform fees and payouts                       | Phase 3                                                                                 | ☐       |
| 6   | Minimum wage by state and trade                                               | Table exists, **empty on purpose**; counsel must supply values                          | ☐       |
| 7   | Child labour: hard block under 18                                             | **Built for Rangers (Phase 1)**; Contracts/Campus in Phases 6-7                         | ☐       |
| 8   | Grievance officer name/contact shown in-app                                   | Phase 4                                                                                 | ☐       |
| 9   | Damage coverage cap and insurer                                               | Config `damage_coverage_cap_paise` = 0 (disabled)                                       | ☐       |
| 10  | Translations (hi/ta/kn/te) legally accurate where they carry legal text       | Drafts; native review needed                                                            | ☐       |
| 11  | **Verification is done by people, not a vendor** (D-016): is this acceptable? | Built as specified by the product owner                                                 | ☐       |
| 12  | **No background check is performed** at Tier 2 (D-016)                        | Tier 2 = address proof + reference call. Counsel to advise on marketing claims          | ☐       |
| 13  | Aadhaar-image handling by a private entity (UIDAI rules)                      | See below                                                                               | ☐       |

## Aadhaar handling (important, needs counsel)

What the product does:

- The app tells the Ranger to upload the **masked** Aadhaar (first 8 digits hidden) and never a card
  showing all 12 digits. The admin review page repeats the rule and the reviewer can send the request
  back (`REQUEST_INFO`) if digits are visible.
- The reviewer types only the **last 4 digits** and the **date of birth**; both are stored AES-256-GCM
  encrypted (`FIELD_ENCRYPTION_KEY`). The full number is never stored, logged or typed into the system.
- Images live in a **private bucket** (server-side encryption to be enabled on the bucket in
  production), are reachable only through 2-minute signed links, every admin view is audit-logged,
  and images are **deleted 30 days after the decision** (`kyc_image_retention_days`).

What the product **cannot** guarantee:

- It cannot detect an unmasked upload. A user can ignore the instruction, so an image with all 12
  digits may sit in storage for up to 30 days. Whether that is permissible for a private entity
  without an Aadhaar authorisation is a question for counsel. An alternative is to accept a different
  ID (voter ID, driving licence) instead of Aadhaar; the schema supports adding document types.
- It cannot prove the selfie is live or that it matches the ID; a human judges that.

## Implemented so far

- **Secrets and personal identifiers never logged.** Pino redacts authorization, cookies, idempotency
  keys, `otp`, `code`, `password`, `aadhaar`, `aadhaarNumber`, `aadhaarLast4`, `dateOfBirth`,
  `refreshToken`. (The sandbox SMS adapter prints the OTP in development only; production refuses it.)
- **OTP codes and refresh tokens are stored hashed**; passwords use scrypt with a per-user salt.
- **Consent** is explicit, per purpose (Terms, Privacy, KYC processing), versioned, and can be withdrawn.
- **Data access**: `GET /me/export` returns everything held about the person.
- **Erasure**: `DELETE /me` locks the account and ends sessions at once; after 30 days a job
  anonymises the account and deletes addresses, contacts, devices, consents, verification records and
  stored files. Audit logs stay (they hold ids, not personal data).
- **Age gate**: an admin cannot approve identity without a date of birth, and under-18 is refused.
- **Audit log is append-only** (DB trigger). Admin decisions and document views are recorded.
- **Sandbox adapters cannot run in production**; payments cannot go live (D-020).
- **No card/UPI details ever touch our database** (Phase 3): Razorpay Checkout collects payment
  details directly; the API only ever stores an order id, a payment id and a signature.
- **Rangers are never charged anything by the platform** (D-037): no fee, commission or deduction
  code path exists for a Ranger's wallet or earnings.

## Retention schedule (draft, for counsel to confirm)

| Table(s)                                               | Contents                                         | Retention                                                    | Note                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`, `user_roles`                                  | Account identity                                 | Life of account; anonymised 30 days after a deletion request | Phone replaced by a tombstone; unique constraint stays valid                                                                                                                                                                                  |
| `otp_attempts`                                         | Hashed OTP, phone, IP                            | Until the account is purged (no scheduled trim yet)          | **Gap**: add a 30-day trim job                                                                                                                                                                                                                |
| `refresh_tokens`                                       | Hashed session tokens                            | Until purge (no scheduled trim yet)                          | **Gap**: delete expired rows                                                                                                                                                                                                                  |
| `devices`                                              | Device id, platform, push token                  | Life of account                                              | Deleted with the account                                                                                                                                                                                                                      |
| `addresses`                                            | Saved addresses + geo point                      | Life of account                                              | Deleted with the account                                                                                                                                                                                                                      |
| `emergency_contacts`                                   | Third-party names and numbers                    | Life of account                                              | Deleted with the account                                                                                                                                                                                                                      |
| `consents`                                             | Consent evidence (purpose, version, IP)          | Life of account                                              | Counsel: may need longer retention as proof of consent                                                                                                                                                                                        |
| `worker_profiles`                                      | Tier, bio, encrypted DOB / Aadhaar last 4        | Life of account                                              | Deleted with the account                                                                                                                                                                                                                      |
| `kyc_checks`, `kyc_reviews`, `professional_references` | Outcome, reviewer, reference contact             | Life of account                                              | Deleted with the account                                                                                                                                                                                                                      |
| `kyc_documents` (rows) + **stored files**              | Identity photos, address proof                   | **30 days after the decision** (config)                      | Row kept as `DELETED`; deleted earlier if the account is purged                                                                                                                                                                               |
| `audit_logs`                                           | Admin/system actions                             | 7 years (proposed)                                           | Immutable; ids only; counsel to confirm                                                                                                                                                                                                       |
| `price_bands`, catalog                                 | Non-personal reference data                      | Indefinite                                                   | Not personal data                                                                                                                                                                                                                             |
| `minimum_wage_rules`                                   | Legal reference data                             | Indefinite, versioned by `effective_from`                    | Counsel-confirmed values only                                                                                                                                                                                                                 |
| `job_locations`                                        | Ranger location points during a job              | **90 days** (config), then trimmed                           | **Gap**: `trim-gps-trails` BullMQ job exists but is not yet scheduled in production                                                                                                                                                           |
| `job_photos` (rows) + **stored files**                 | Before/after job photos                          | Life of the job record (kept for dispute evidence)           | Not yet time-limited; review with counsel                                                                                                                                                                                                     |
| `chat_threads`, `chat_messages`                        | In-app job chat (no real phone numbers)          | Life of the job record                                       | Never contains masked/real numbers; content is job-scoped only                                                                                                                                                                                |
| `request_media`                                        | Request photos and voice note                    | Life of the request/job record                               | Deleted with the account like other job-linked data                                                                                                                                                                                           |
| `trusted_shares`                                       | Hashed public tracking token                     | 12 hours (hard expiry), row kept after for audit             | Token itself is never stored, only its hash                                                                                                                                                                                                   |
| `customer_wallets`, `wallet_holds`                     | Token balance, held tokens                       | Life of account                                              | Deleted with the account; no personal data beyond the user id                                                                                                                                                                                 |
| `wallet_ledger_entries`                                | Append-only token transaction history            | Life of account (financial audit trail)                      | Immutable; ids only, no card/UPI details ever stored here                                                                                                                                                                                     |
| `token_bundles`                                        | Non-personal SKU/catalog data                    | Indefinite                                                   | Not personal data                                                                                                                                                                                                                             |
| `payment_orders`                                       | Order amount, status, Razorpay order/payment ids | Life of account                                              | **No card, UPI VPA or bank details are ever stored** — Razorpay Checkout collects those directly; the API only ever sees an order id, a payment id and a signature (D-040/D-041), which keeps this table out of PCI-DSS cardholder-data scope |

Later phases append their tables here (GPS trails, chat, payments, etc.).
