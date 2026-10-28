# 10 — Compliance and Gaps

> Source: `docs/COMPLIANCE.md` (read in full), `docs/RUNBOOK.md`'s "Production notes," "Before
> launch (ops checklist)," and "Going live with real SMS" sections (read in full), plus direct
> code verification of specific claims in this session (see the auto-release correction below).

## Reconciliation: `docs/COMPLIANCE.md` is internally inconsistent about deletion

`COMPLIANCE.md`'s counsel checklist (row 1) was updated to reference D-108's 48-hour grace
period. But the **same file's "Implemented so far" section** (line 54) still reads: *"Erasure:
`DELETE /me` locks the account and ends sessions at once; after 30 days a job anonymises the
account..."* — this is the **old**, superseded D-024 behaviour. The retention schedule table
further down (line 71) also still says *"anonymised 30 days after a deletion request."* Both of
these are now wrong relative to the actual code (`01-overview-and-status.md`,
`02-job-flow-and-money.md`'s state machine section do not cover this — see the users module in
`04-data-model.md`/`07-trust-safety-security.md` and the live code in
`apps/api/src/users/users.service.ts::requestDeletion`). **Anyone relying on `COMPLIANCE.md` for
counsel review right now would be shown a stale description of the deletion mechanism** in two of
its three places.

## Everything flagged as needing a lawyer or CA

Directly from `docs/COMPLIANCE.md`'s counsel checklist (13 items, all still unchecked `☐` in the
file as of this session):

| # | Item | What the code currently does |
|---|---|---|
| 1 | DPDP: consent, purpose limitation, retention, deletion + export | Built — consent screen, versioned consent records, `GET /me/export`, 48-hour cancellable deletion (D-108) |
| 2 | Aadhaar: never store the full number | **Partly** — the app instructs users to upload a masked copy and only the reviewer-typed last-4 digits + DOB are stored (encrypted); the app **cannot detect** an unmasked upload if a user ignores the instruction — a full-number image could sit in storage for up to 30 days undetected |
| 3 | Independent-contractor ToS for Rangers | Placeholder screens only; Contract labour and Campus have **no separate ToS** |
| 4 | ToS / Privacy Policy / Refund Policy text | Placeholder text, explicitly marked in-app "needs counsel review" |
| 5 | TDS, GST, invoicing rules for platform fees and payouts | `gst_on_fee_bps`/`payout_tax_bps`/`aggregator_welfare_fee_bps` all seeded **0** — explicitly "pending that review, not a considered 'no tax' decision" (`RUNBOOK.md:456-458`) |
| 6 | Minimum wage by state/trade | Table exists, **deliberately empty** — counsel must supply real values |
| 7 | Child labour: hard block under 18 | Built for Rangers, Contract labour (`kycTier >= 1`), and Campus (self-declared DOB) |
| 8 | Grievance officer shown in-app | Built; name/email/phone are **placeholders**, need a real appointee |
| 9 | Damage coverage cap and insurer | `damage_coverage_cap_paise = 0` — **disabled**, no insurer |
| 10 | Legally-accurate translations (hi/ta/kn/te) | Drafts only; native-speaker legal review not done |
| 11 | Verification done by people, not a vendor — acceptable? | Built as specified; a business/legal acceptability question, not technical |
| 12 | No background check at Tier 2 | Tier 2 = address proof + reference call only; counsel to advise on any marketing claims about "verified" Rangers |
| 13 | Aadhaar-image handling by a private entity (UIDAI rules) | See item 2's detail; this is the same underlying question from UIDAI's side rather than DPDP's |

**Also from `RUNBOOK.md:459-461`, not in the formal checklist but flagged as a legal question**:
whether a *stronger* identity hash (the full Aadhaar number, not just the already-masked last 4)
may ever be collected to make the duplicate-account fraud check (`identityHash`,
`07-trust-safety-security.md`) strong enough to act on by itself — explicitly called "a legal/
DPDP/UIDAI question, not a technical one."

## Everything not built, stubbed, or placeholder — and what's needed to finish it

| Gap | Current state | What's needed |
|---|---|---|
| Real price list | Seeded with placeholders, `needsSurvey: true` flag set | A real market-rate survey (e.g. Chennai, per `RUNBOOK.md`), then `POST /v1/admin/price-list` to set real values — **no admin UI page for this yet, REST-only** |
| Minimum wage table | Empty on purpose | Counsel-confirmed values per state/trade |
| Face-matching / automated KYC | `ManualAdminKycProvider` only — human review, no liveness or document-authenticity check | A vendor integration (the adapter interface pattern already exists for every other vendor; this one has no sandbox *or* live implementation to model it after yet — it would be new) |
| Masked calling | Interface only, zero implementations, `CALLS_MODE` pinned `disabled` | Pick a vendor (code comment suggests Exotel as an example), implement `CallProvider`, wire `CALLS_MODE=live` |
| Insurance / damage coverage | `damage_coverage_cap_paise = 0` | An insurer relationship and a real cap; currently fully disabled, not partially built |
| Live payouts to a Ranger's bank account | **Not found anywhere in the codebase.** `WorkerWallet`/`WorkerWalletLedgerEntry` track balances and dues internally; no code moves money *out* of the platform to a real bank account | A payout-rail integration (e.g. Razorpay Payouts/RazorpayX, a different product from the Checkout integration already used) — this is a materially separate build, not a config flip |
| Completion-code auto-release | `completion_otp_auto_release_hours: 24` is **defined but never read by any code** — verified this session (`grep -rln "completion_otp_auto_release_hours" apps/api/src` matches only its own definition in `fee.service.ts`) | A scheduled job (the existing BullMQ maintenance-queue pattern, or the in-process `scheduler.service.ts` ticker, would both fit) that finds jobs in `COMPLETED_BY_WORKER` past the deadline with no open dispute and transitions them to `CONFIRMED_BY_CUSTOMER` on the Ranger's behalf. `RUNBOOK.md`'s own checklist (line 462-465) independently flags this exact gap and calls it a real risk: *"a withheld code can't strand a Ranger's payout indefinitely"* — today, it can |
| Token-bundle migration decision | D-081 replaced tokens with the platform fee; `CustomerWallet.balanceTokens` on any pre-existing account is now functionally **dead** (the purchase UI was removed this session, D-106, on top of that) | A decision between three documented options (leave dead, Razorpay-refund it, convert to platform-fee credit) — `RUNBOOK.md:447-450` warns leaving it dead risks "a real complaint waiting to happen once tokens stop doing anything" |
| Employer verification (Contract labour) | **None** — any account can add the `EMPLOYER` role and post a Contract listing with zero document check (Campus listings do require an admin "verify" click, but that's a business-name claim, not a registry lookup) | A decision on whether/how to verify Contract-labour employers before launch (D-056) |
| Admin UI for employer verification | Backend exists (`GET/POST /admin/employers/...`), **no page** in `apps/admin` | Build the page — unlike the KYC queue, which already has one |
| Admin UI for SOS / disputes / incident reports / fraud review / config / price list | All six have working API endpoints and **no admin page** (`06-features-by-role.md`) | Six pages, following the existing KYC-queue page as the pattern |
| Live push notifications, verified | `FcmPushProvider` exists but `RUNBOOK.md:439-441` states it "has never been exercised against a real Firebase project" | Create a real Firebase project, set `PUSH_MODE=live` + `FCM_SERVICE_ACCOUNT_JSON`, and test on a real dev-build Android phone |
| iOS push | Not wired (APNs→FCM bridge missing, D-051) | Either build the bridge, or ship iOS with push disabled and disclose it in the App Store listing |
| Failed-maintenance-job alerting | The four daily BullMQ jobs run, but nothing alerts if one lands in BullMQ's failed-job set | Add alerting (flagged as a "Phase 8 gap" in `RUNBOOK.md:412-414`) |

## Exact steps from the current test environment to production

Compiled directly from `docs/RUNBOOK.md`'s "Before launch (ops checklist)" (21 items, read in
full) and "Production notes"/"Going live with real SMS" sections. Grouped here by category rather
than reproduced as one flat 21-item list:

**Pricing and money, before any real booking can be trusted:**
1. Review and set real price-list rates (`POST /v1/admin/price-list`) — currently placeholders
   flagged `needsSurvey: true`.
2. Review seeded `PriceBand`s (placeholders, `sample_size = 0`).
3. Review the Phase-Commerce fee defaults in `system_config` (`platform_fee_bps`,
   `platform_fee_min_paise`, `online_payment_discount_bps`, `worker_dues_threshold_paise`).
4. Review seeded Haggler Plus plan prices and the Rush/Boost fee amounts.
5. Review seeded token-bundle prices (even though the purchase UI is gone, the backend endpoint
   is still reachable — `wallet.controller.ts`).
6. Set `tier_bonus_monthly_budget_paise` and `damage_coverage_cap_paise` (both 0 = disabled today).
7. Get a legal/CA read on GST/payout-tax/aggregator-welfare-fee config (all seeded 0).
8. Decide the token-bundle migration path (leave dead / refund / convert to fee credit).

**Payments:**
9. Switch `PAYMENTS_MODE` to `test` with **real Razorpay TEST keys** and a real webhook
   subscription before any non-sandbox testing — note there is still **no `live` mode anywhere**
   (D-020 hard-refuses live keys at boot; going fully live needs that guard deliberately revisited).

**Identity and safety:**
10. Decide who the KYC reviewers are and train them on the masked-Aadhaar rule.
11. Decide who the `DISPUTE_AGENT` reviewers are for the SOS and dispute queues.
12. Decide on Contract-labour employer verification (currently none) before launch.
13. Build the missing employer-verification admin UI page.
14. Review which categories need `requiresLicense` (today only `gas_appliance_repair` is seeded
    `true`) — decide if any other category legally needs a trade license.
15. Decide whether Campus student age verification should move from self-declared to
    admin-reviewed.
16. Implement the completion-code auto-release job (see the gap above) before relying on
    `completion_otp_enabled`'s default-on state in production — otherwise a withheld code can
    strand a Ranger's payout indefinitely.

**Infrastructure and secrets:**
17. Rotate every secret currently in plaintext chat history per `RUNBOOK.md`'s "Rotating secrets
    later" section — **this specifically includes the Supabase database password pasted into this
    session's own chat transcript**, which should be rotated via the Supabase dashboard regardless
    of anything else in this checklist.
18. Confirm Render auto-deploy-on-push is actually configured (this session found it was not —
    see `03-architecture-and-stack.md`'s Reconciliation note) or accept manual deploys as the
    ongoing process.
19. Create a real Firebase project for live push and verify it on a real device.
20. Wire or explicitly disable iOS push before any iOS release.
21. Translations: have native speakers review hi/ta/kn/te, especially anywhere legal text is
    shown.
22. Appoint a real Grievance Officer and replace the placeholder contact details.
23. Add alerting for failed BullMQ maintenance jobs.

**SMS (from `RUNBOOK.md`'s dedicated "Going live with real SMS" section, D-091/D-093, not
individually re-read line-by-line in this pass)**: the live `Msg91SmsProvider` adapter already
exists (`05-api-and-realtime.md`); going live with it needs a real Msg91 account, DLT
(Distributed Ledger Technology, India's SMS-template-registration regime) template registration,
and `SMS_MODE=live` with real credentials — the section covers this in more detail than
summarized here and should be read directly before attempting it.
