# 09 — Decisions and History

> Source: `docs/DECISIONS.md` (read for structure, not every entry in full — 98 unique decision
> numbers found), `git log` (95 commits as of this file, 87 before this dossier's own 8 commits).

## Decision log coverage — a reconciliation note up front

`docs/DECISIONS.md` documents **98 unique decisions**: D-001 through D-067, D-069 through D-096
(D-068 is a gap — likely renumbered or merged into an adjacent entry, not independently
investigated), D-100, D-101, D-108. Early decisions (roughly D-001–D-077) are written as inline
bold entries (`**D-0XX Title.** ...`); later ones (D-078 onward, the "Phase Flow-Final" era) are
full `## D-0XX: Title` sections with much more detail.

**Nine decisions exist only as git commit messages, never written up in `DECISIONS.md`**: D-097,
D-098, D-099, D-102, D-103, D-104, D-105, D-106, D-107. All nine are real, shipped changes — see
`01-overview-and-status.md`'s Reconciliation section for why this matters (most importantly: the
customer-wallet token UI removal, D-106, and the Settings/deletion-flow changes, D-107, are both
in this gap).

## Decisions grouped by theme

### Foundation & platform (D-001 to D-018, roughly)
Monorepo setup, NestJS/Prisma/Postgres+PostGIS/Redis base stack, the shared-schema package
pattern, CI pipeline shape, Docker Compose dev infra, error-envelope/logging conventions.

### Auth, sessions, admin access (D-019 to D-025)
OTP-based phone login, JWT access + rotating refresh-token-family design (D-023), DPDP account
deletion (D-024 — **superseded in behaviour by D-108**, see `01-overview-and-status.md`), separate
admin JWT audience (D-025). D-020 is the Razorpay test-keys-only hard refusal still in force today
(`05-api-and-realtime.md`).

### Profile & data model shape (D-026 to D-047ish)
Which profile tables exist in which phase (worker/employer/student profiles arriving as their
roles were built, not all at once), consent versioning, KYC document/review tables, the review
system that later fed the client-league ratings (D-047, noted as "previously unused" until
D-077's client league actually consumed it).

### KYC & masked calling (D-019, D-050s)
Manual KYC review provider; masked calling explicitly scoped as **interface-only, no vendor
picked** (D-019) — still true today (`07-trust-safety-security.md`).

### Push, realtime, Phase-numbered feature rollout (D-048 to D-067, Phase 2-9 commits)
The large "Phase N" commits (Phase 2 Core Marketplace through Phase 9 Monetization, all landing
2026-09-29/30 per `git log`) correspond to this decision range: broadcast/matching, Socket.IO
realtime, Contract labour, Campus, admin moderation tooling, Haggler Plus/Rush/Boosted listings.

### Reputation & leagues (D-076, D-077)
Both league ladders (Ranger and client), built on `WorkerStats`/`CustomerStats` and the
previously-dormant `Review` ratings. See `06-features-by-role.md` for the full threshold tables.

### Infra move & performance (D-074, D-078, D-079)
The Sydney→Mumbai/Singapore region move and its measured latency improvement
(`03-architecture-and-stack.md`), plus a `confirm()` latency root-cause investigation and five
fixes (D-079, title only read — the fixes themselves not individually re-verified in this pass).

### Phase Commerce + Safety (D-080 to D-086)
Fixed price list replacing negotiation (D-080), the platform-fee/pay-after model replacing tokens
(D-081 — **tokens stayed as dormant backend infrastructure, not deleted**, directly relevant to
D-106 later), cash/online payment UI (D-082), tier-3 category licensing + SOS (D-083), disputes +
"other"-job moderation (D-084), the location weak-signal retry queue (D-085), a UI/UX pass
(D-086). This is the point the dossier task's own instructions call "the Commerce + Safety work" —
everything from D-087 onward is "Phase Flow-Final" and what came after it.

### Phase Flow-Final (D-087 to D-096)
The on-demand job's current state machine and quote-first flow: schema/state-machine foundation
(D-087), the quote engine (D-088, shipped behind `quote_flow_enabled` defaulting **false**
initially), cash-disabled-by-default + completion code (D-089 — including the documented
deviation from the master prompt's literal wording, see `02-job-flow-and-money.md`), pause-for-
parts (D-090), OTP/job-code hardening (D-091 — the allowlist that was later fully reverted),
settlement/handover finishing touches (D-092), incident reports + auto-hold + duplicate-identity
flag (D-093), fraud signal queue + a real cancel-fee bypass fix (D-094), mobile typecheck drift
fix (D-095), and finally **turning both `quote_flow_enabled` and `completion_otp_enabled` on by
default** (D-096) — the point at which the new flow became what a new job actually uses.

### Post-master-prompt fixes, driven by direct user prompting (D-097 to D-108)
Undocumented-in-`DECISIONS.md` but real: lint cleanup (D-097), RUNBOOK SMS/e2e documentation
(D-098), a real migration ordering bug fix (D-099, new enum value used in the same transaction
that added it). Documented again from D-100: the `TESTING_MODE` allowlist fully reverted after it
broke real tester access with no fallback (D-100), email OTP as a free opt-in fallback channel
(D-101). Then the undocumented run again: email-OTP validation UX and three other bug fixes
(D-102), student profile expansion (D-103), home-screen personalization (D-104), Contract-jobs
redesign (D-105), customer-wallet token UI removal (D-106), Settings redesign (D-107). Documented
again for D-108: the 48-hour cancellable deletion grace period, data-export UI removal, and
role tags — the newest work, this session.

## Timeline from `git log` (first commit to latest)

| Date | Milestone |
|---|---|
| 2026-09-28 | Phase 0 (foundation) and Phase 1 (identity/KYC) |
| 2026-09-29 | Phase 2 (core marketplace) through Phase 5 (push/realtime) — four phases in one day |
| 2026-09-29/30 | Phase 6 (Contracts), Phase 7 (Campus), Phase 8 (admin tooling), Phase 9 (monetization) |
| 2026-10-05 – 2026-10-06 | D-078/D-079 — infra region move, `confirm()` latency fixes (documentation-only commits, no app code) |
| 2026-10-11 | D-081 through D-086 — Phase Commerce + Safety, sub-phases A through F |
| 2026-10-12 | D-087 through D-099 — Phase Flow-Final, foundation through the two flags turning on, plus the lint/RUNBOOK/migration-bug trio — **13 decision-worthy changes in one day** |
| 2026-10-22 | D-100 (TESTING_MODE allowlist reverted), D-101 (email OTP fallback) |
| 2026-10-26 | D-102 through D-105 — the start of the 12-item UX punch-list fixes (email-OTP UX, KYC flow, student profile, home personalization, Contracts redesign) |
| 2026-10-28 | D-106, D-107 — wallet cleanup, Settings redesign |
| 2026-10-28/29 | D-108 — deletion grace period, data-export removal, role tags; this dossier itself (8 files, this session) |

Roughly **31 days** from first commit to the latest, with two distinct working patterns visible in
the dates: dense multi-phase days early on (Sep 28-30, Oct 11-12) versus the later stretch
(Oct 22 onward) being spaced, smaller, user-driven fix rounds rather than master-prompt phases.

## Repository statistics

All counts produced by running the command shown, in this session, against the current `main`
branch (commit count as of writing this file — it will be one higher by the time this file itself
is committed).

| Metric | Command | Result |
|---|---|---|
| Total commits | `git log --oneline \| wc -l` | **95** (87 before this dossier's 8 files) |
| Total tracked files | `git ls-files \| wc -l` | **515** |
| Files in `apps/api` | `git ls-files \| grep '^apps/api/' \| wc -l` | **218** |
| Files in `apps/mobile` | `git ls-files \| grep '^apps/mobile/' \| wc -l` | **232** |
| Files in `apps/admin` | `git ls-files \| grep '^apps/admin/' \| wc -l` | **19** |
| Files in `packages/shared` | `git ls-files \| grep '^packages/shared/' \| wc -l` | **15** |
| Files in `docs` | `git ls-files \| grep '^docs/' \| wc -l` | **16** (before this dossier) |
| Lines of code, `apps/api/src` (`.ts`, excluding `.spec.ts`) | `find apps/api/src -name "*.ts" -not -name "*.spec.ts" \| xargs wc -l \| tail -1` | **16,054** |
| Lines of code, `apps/mobile/src` (`.ts`/`.tsx`, excluding specs) | `find apps/mobile/src -name "*.ts" -o -name "*.tsx" \| grep -v spec \| xargs wc -l \| tail -1` | **15,750** |
| Lines of code, `packages/shared/src` | `find packages/shared/src -name "*.ts" \| xargs wc -l \| tail -1` | **1,944** |
| Lines of code, `apps/admin/src` | `find apps/admin/src -name "*.ts" -o -name "*.tsx" \| xargs wc -l \| tail -1` | **972** |
| Prisma models | `grep -c "^model " apps/api/prisma/schema.prisma` | **65** |
| Prisma migrations | `ls apps/api/prisma/migrations \| grep -v toml \| wc -l` | **27** |
| API endpoints | `grep -rE "@(Get\|Post\|Patch\|Put\|Delete)\(" apps/api/src --include="*.controller.ts" \| wc -l` | **175** |
| API unit test files | `find apps/api/src -name "*.spec.ts" \| wc -l` | **24** |
| API e2e test files | `find apps/api/test -name "*.e2e-spec.ts" \| wc -l` | **19** |
| Mobile test files | `find apps/mobile/src -name "*.spec.ts*" \| wc -l` | **58** |
