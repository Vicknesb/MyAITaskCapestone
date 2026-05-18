# DevPulse — Formal Specification

**Version:** 1.0  
**Date:** 2026-05-18  
**Author:** DevPulse Engineering  
**Status:** Approved

---

## Table of Contents

1. [Requirements](#1-requirements)
2. [Technical Design](#2-technical-design)
3. [Implementation Plan](#3-implementation-plan)
4. [Scope Boundaries](#4-scope-boundaries)
5. [Success Criteria](#5-success-criteria)
6. [Grading Rubric Cross-Reference](#6-grading-rubric-cross-reference)

---

## 1. Requirements

### 1.1 User Stories and Acceptance Criteria

---

#### US-01 — Account Registration

> As an **engineering team member**, I want to create a DevPulse account, so that I can access the analytics dashboard.

**Acceptance Criteria:**

1. A registration form collects `email`, `password`, and optional `name`.
2. Email must be a valid format; password must be at least 8 characters.
3. Submitting a duplicate email returns a clear error: "An account with this email already exists."
4. On success, the user is redirected to `/dashboard` and is automatically logged in.
5. Passwords are never stored in plain text (bcrypt, cost factor 12).
6. The registration endpoint is rate-limited to 5 requests per hour per IP.

---

#### US-02 — Authentication

> As a **registered user**, I want to log in and stay logged in across browser sessions, so that I don't have to authenticate on every visit.

**Acceptance Criteria:**

1. Login form accepts `email` and `password`.
2. Wrong credentials return "Invalid email or password" without distinguishing which field was wrong.
3. A successful login sets an `HttpOnly; Secure; SameSite=Strict` session cookie valid for 7 days.
4. If a session has less than 24 hours remaining, it is automatically renewed on the next request.
5. Logging out immediately invalidates the session server-side (deleted from DB).
6. An expired or revoked session redirects the user to `/login`.
7. Login is rate-limited to 10 requests per 15 minutes per IP.

---

#### US-03 — Connect a GitHub Repository

> As an **engineering lead**, I want to connect one of my GitHub repositories to DevPulse, so that I can start tracking its activity.

**Acceptance Criteria:**

1. A "Connect Repo" modal accepts `repository full name` (e.g., `owner/repo`) and a GitHub Personal Access Token (PAT).
2. DevPulse validates the token against GitHub before saving (returns error if token is invalid or repo not found).
3. The GitHub token is encrypted at rest (AES-256-GCM); it is never stored in plain text.
4. On success, the repository appears in the repo list within 2 seconds.
5. Connecting an already-connected repository returns an error: "Repository already connected."
6. A user may connect at most 10 repositories.
7. An initial data sync begins automatically after connecting.

---

#### US-04 — View Commit Frequency

> As a **developer**, I want to see how often commits are being made to a repository over a selected time period, so that I can understand the team's development cadence.

**Acceptance Criteria:**

1. The dashboard displays a stacked bar chart of commit counts grouped by day.
2. Each bar is broken down by author login.
3. A date range picker allows filtering by any range up to 90 days.
4. The chart shows a loading skeleton while data is being fetched.
5. If no commits exist for the period, an empty state message is shown.
6. Hovering a bar segment shows a tooltip with author name and exact commit count.

---

#### US-05 — View Pull Request Statistics

> As an **engineering lead**, I want to see PR open, merge, and close rates for a repository, so that I can identify bottlenecks in the review process.

**Acceptance Criteria:**

1. A line chart displays three series: open PRs, merged PRs, and closed (unmerged) PRs over time.
2. Average merge time (hours from open to merge) is displayed as a summary stat above the chart.
3. The same date range filter from US-04 applies.
4. Data reflects the state of PRs at each point in time, not just the current state.

---

#### US-06 — View Team Activity

> As an **engineering lead**, I want to see an activity timeline showing push events and active days, so that I can spot periods of high and low activity.

**Acceptance Criteria:**

1. An area chart shows push event density over the selected date range.
2. A summary card shows total active days and peak activity hour (UTC) for the period.
3. The chart updates when the date range is changed without a full page reload.

---

#### US-07 — View Contributor Breakdown

> As a **developer**, I want to see a ranked list of contributors by commit and PR count, so that I understand each team member's relative activity.

**Acceptance Criteria:**

1. A bar chart ranks contributors by commit count for the selected period.
2. Each contributor row displays their GitHub avatar, login, commit count, and PR count.
3. Contributors with zero activity in the period are not shown.

---

#### US-08 — Activity Feed

> As a **developer**, I want to see a chronological feed of recent commits and PR events, so that I can quickly catch up on what the team has been doing.

**Acceptance Criteria:**

1. The feed shows the 20 most recent events (commits + PR opens/merges/closes) across all connected repos.
2. Each item shows: event type icon, actor avatar, actor login, action description, repo name, and relative timestamp (e.g., "3 hours ago").
3. Clicking an item links to the corresponding GitHub URL in a new tab.
4. The feed can be scoped to a single repository using the repo selector.

---

#### US-09 — Manual Sync

> As a **developer**, I want to trigger a data sync for a repository on demand, so that I can see the latest activity without waiting for a scheduled sync.

**Acceptance Criteria:**

1. Each repo card has a "Sync Now" button.
2. Clicking "Sync Now" starts a sync and changes the button to a loading state.
3. The sync status is reflected in real-time on the repo card: PENDING → RUNNING → SUCCESS or FAILED.
4. If a sync is already running, "Sync Now" is disabled with a tooltip: "Sync in progress."
5. A failed sync displays the error reason on the repo card.
6. Manual syncs are rate-limited to 2 per 10 minutes per repository.

---

#### US-10 — Disconnect a Repository

> As a **developer**, I want to disconnect a repository I no longer need to track, so that the dashboard stays focused on relevant repos.

**Acceptance Criteria:**

1. Each repo card has a "Disconnect" button.
2. Clicking "Disconnect" shows a confirmation dialog: "Are you sure? This will remove all synced metrics for this repository."
3. On confirmation, the repo and its metrics are removed from the user's view.
4. If other users have the same repo connected, their data is unaffected.
5. The repo card disappears from the list immediately after disconnection.

---

#### US-11 — Aggregated Dashboard View

> As an **engineering lead**, I want to see a single summary view across all connected repositories, so that I can assess overall team health at a glance.

**Acceptance Criteria:**

1. The dashboard shows four summary cards: Total Commits, PRs Merged, Active Contributors, and Repos Tracked.
2. All numbers reflect the selected date range.
3. A per-repo breakdown section shows the latest metrics card for each connected repository.
4. The view loads within 3 seconds for up to 10 connected repositories.

---

## 2. Technical Design

### 2.1 Data Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DevPulse — Entity Diagram                        │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────┐         ┌──────────────────┐         ┌──────────────────┐
│    User      │ 1     * │  UserRepository  │ *     1 │   Repository     │
│──────────────│─────────│──────────────────│─────────│──────────────────│
│ id (cuid)    │         │ id (cuid)        │         │ id (cuid)        │
│ email UNIQUE │         │ user_id FK       │         │ github_repo_id   │
│ password_hash│         │ repository_id FK │         │   (Int, UNIQUE)  │
│ name?        │         │ role             │         │ full_name        │
│ created_at   │         │ connected_at     │         │ owner            │
│ updated_at   │         └──────────────────┘         │ name             │
└──────────────┘                                      │ description?     │
       │                                              │ is_private       │
       │ 1                                            │ default_branch   │
       │                                              │ github_token_enc │
       ▼ *                                            │ token_iv         │
┌──────────────┐                                      │ token_tag        │
│   Session    │                                      │ created_at       │
│──────────────│                                      │ updated_at       │
│ id (cuid)    │                                      └──────────────────┘
│ user_id FK   │                                               │
│ token_hash   │                                               │ 1
│   UNIQUE     │                                               │
│ expires_at   │                                               │ *
│ user_agent?  │                                      ┌──────────────────┐
│ ip_address?  │                                      │     Metric       │
│ created_at   │                                      │──────────────────│
└──────────────┘                                      │ id (cuid)        │
                                                      │ repository_id FK │
                                                      │ type (MetricType)│
                                                      │ recorded_at      │
                                                      │ period_days      │
                                                      │ payload (Json)   │
                                                      │ created_at       │
                                                      └──────────────────┘
                                                               │
                                                               │ 1
                                                               │
                                                               │ *
                                                      ┌──────────────────┐
                                                      │    SyncLog       │
                                                      │──────────────────│
                                                      │ id (cuid)        │
                                                      │ repository_id FK │
                                                      │ status (enum)    │
                                                      │ triggered_by     │
                                                      │ started_at       │
                                                      │ finished_at?     │
                                                      │ last_synced_at?  │
                                                      │ items_fetched    │
                                                      │ error_message?   │
                                                      │ rate_remaining?  │
                                                      └──────────────────┘

Enums:
  MetricType : COMMIT_FREQ | PR_STATS | ACTIVITY | CONTRIBUTOR
  SyncStatus : PENDING | RUNNING | SUCCESS | FAILED

Unique Constraints:
  Session.token_hash
  Repository.github_repo_id
  UserRepository.(user_id, repository_id)
  Metric.(repository_id, type, recorded_at, period_days)
```

**Metric Payload Shapes**

```ts
// MetricType.COMMIT_FREQ
{ commit_count: number; author_breakdown: { login: string; count: number; avatar_url: string }[] }

// MetricType.PR_STATS
{ open: number; merged: number; closed: number; avg_merge_time_hrs: number; review_count: number }

// MetricType.ACTIVITY
{ active_days: number; peak_hour: number; push_events: number }

// MetricType.CONTRIBUTOR
{ contributors: { login: string; avatar_url: string; commits: number; prs: number }[] }
```

---

### 2.2 API Contracts

**Standard Response Envelope**
```ts
type ApiResponse<T> =
  | { success: true;  data: T }
  | { success: false; error: string; code?: string }
```

| # | Method | Path | Auth | Request | Success | Key Error Codes |
|---|--------|------|------|---------|---------|-----------------|
| 1 | POST | `/api/auth/register` | No | `{ email, password, name? }` | 201 `{ id, email, name }` | `VALIDATION_ERROR`, `EMAIL_TAKEN` |
| 2 | POST | `/api/auth/login` | No | `{ email, password }` | 200 `{ token, expires_at }` + cookie | `VALIDATION_ERROR`, `INVALID_CREDENTIALS` |
| 3 | DELETE | `/api/auth/logout` | Yes | — | 200 `{ message }` + clear cookie | `UNAUTHORIZED` |
| 4 | GET | `/api/auth/me` | Yes | — | 200 `{ id, email, name, created_at }` | `UNAUTHORIZED` |
| 5 | GET | `/api/repos` | Yes | — | 200 `{ repositories[] }` with sync status | `UNAUTHORIZED` |
| 6 | POST | `/api/repos/connect` | Yes | `{ full_name, github_token }` | 201 `{ id, full_name, github_repo_id, connected_at }` | `VALIDATION_ERROR`, `GITHUB_TOKEN_INVALID`, `REPO_NOT_FOUND`, `REPO_ALREADY_CONNECTED`, `REPO_LIMIT_EXCEEDED` |
| 7 | DELETE | `/api/repos/:id` | Yes | — | 200 `{ message }` | `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND` |
| 8 | GET | `/api/metrics/:repoId` | Yes | `?from&to&type` | 200 `{ repository, metrics[] }` | `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND` |
| 9 | GET | `/api/dashboard` | Yes | `?from&to` | 200 `{ period, summary, per_repo[] }` | `UNAUTHORIZED` |
| 10 | POST | `/api/sync/:repoId` | Yes | — | 202 `{ sync_log_id, status }` | `FORBIDDEN`, `NOT_FOUND`, `SYNC_IN_PROGRESS` |

**Auth mechanism:** JWT (HS256) in HttpOnly cookie `devpulse_session`. All mutating routes also require `X-CSRF-Token` header matching the `devpulse_csrf` non-HttpOnly cookie (double-submit CSRF pattern).

---

### 2.3 Component Tree

```
app/
├── (auth)/
│   ├── layout.tsx [AuthLayout]
│   │   └── props: { children }
│   │   └── behavior: centered card, DevPulse logo; redirect → /dashboard if authed
│   ├── login/page.tsx [LoginPage]
│   │   └── LoginForm
│   │       └── props: none (calls useAuth.login internally)
│   │       └── children: Input(email), Input(password), Button(submit)
│   └── register/page.tsx [RegisterPage]
│       └── RegisterForm
│           └── children: Input(name), Input(email), Input(password), Button(submit)
│
└── (dashboard)/
    ├── layout.tsx [DashboardLayout]
    │   ├── props: { children }
    │   ├── Sidebar
    │   │   └── NavLink × 3 (Dashboard, Repos, Settings)
    │   └── TopBar
    │       └── UserMenu → Button(logout)
    │
    ├── dashboard/page.tsx [DashboardPage]
    │   ├── DateRangePicker — props: { value, onChange }
    │   ├── RepoSelector — props: { value, onChange, repos[] }
    │   ├── DashboardSummaryCard × 4 — props: { label, value, isLoading }
    │   ├── CommitFrequencyChart — props: { data[], isLoading, height? }
    │   ├── PRStatsChart — props: { data[], isLoading, height? }
    │   ├── ContributorChart — props: { data[], isLoading }
    │   ├── ActivityTimeline — props: { data[], isLoading, height? }
    │   └── ActivityFeed — props: { repositoryId?, limit?, isLoading }
    │       └── ActivityFeedItem × N — props: { item: ActivityItem }
    │
    ├── repos/page.tsx [ReposPage]
    │   ├── Button("Connect Repo") → opens ConnectRepoModal
    │   ├── RepoCard × N
    │   │   └── props: { repo, onSync, onDisconnect }
    │   │   └── children: Badge(privacy), Button(Sync Now), Button(Disconnect)
    │   └── ConnectRepoModal
    │       └── props: { isOpen, onClose, onSuccess }
    │       └── children: Input(full_name), Input(github_token), Button(submit)
    │
    └── settings/page.tsx [SettingsPage]
        └── ProfileForm — props: none (calls useAuth internally)
            └── children: Input(name), Input(password), Button(save)

components/ui/
├── Button — variant, size, isLoading, disabled
├── Input — label, error, helpText, ...HTMLInputAttributes
├── Card — title?, description?, actions?, className?
├── Badge — variant ("default"|"success"|"warning"|"error"|"info"), label
├── Select — options[], value, onChange, placeholder
├── DateRangePicker — value: { from, to }, onChange, maxRange?
├── Spinner — size ("sm"|"md"|"lg")
└── ErrorBoundary — fallback (ReactNode)

hooks/
├── useAuth() → { user, isLoading, login(), logout(), register() }
├── useRepos() → { repos, isLoading, connectRepo(), disconnectRepo(), syncRepo() }
├── useMetrics(repoId, from?, to?, type?) → { metrics, isLoading, error }
└── useDashboard(from?, to?) → { dashboard, isLoading, error }
```

---

## 3. Implementation Plan

### Phase Overview

| Phase | Description | Deliverable | Estimate |
|-------|-------------|-------------|----------|
| **0** | Project scaffolding | Bootable Next.js 15 app with all tooling wired | 6–8 h |
| **1** | Data model + migrations | Migrated DB, seed data, `types/`, Zod schemas | 6–8 h |
| **2** | Auth system | Working register/login/logout/me API with tests | 10–12 h |
| **3** | Repo management + MCP | Connect/disconnect/list repos; GitHub MCP client | 12–14 h |
| **4** | Metrics sync engine | Sync pipeline, metrics API, dashboard API | 14–16 h |
| **5** | Frontend | Full UI: primitives → auth → layout → repos → charts → dashboard | 20–24 h |
| **6** | Testing | All four test layers passing; Docker Compose test DB | 10–12 h |
| **7** | CI/CD | Green GitHub Actions pipeline on every PR | 6–8 h |
| **8** | Security hardening | Headers, ESLint rules, rate limiting, Lighthouse ≥ 80 | 10–12 h |
| **Total** | | | **94–114 h** |

*With 15% integration buffer: ~110–130 h (~18–22 developer-days at 6 h/day)*

### Phase 0 — Scaffolding

```bash
npx create-next-app@15 . --typescript --tailwind --app
```

Key tasks:
- `tsconfig.json`: `strict: true`, path aliases (`@/lib/*`, `@/components/*`, `@/types/*`)
- Install: `prisma`, `@prisma/client`, `zod`, `bcryptjs`, `jsonwebtoken`, `clsx`, `tailwind-merge`, `recharts`, `react-hook-form`, `@hookform/resolvers`, `@tanstack/react-query`
- Dev: `vitest`, `@testing-library/react`, `msw`, `playwright`, all `@types/*`
- Scaffold directory structure matching `CLAUDE.md`
- `lib/db/prisma.ts` — Prisma singleton
- `lib/cn.ts` — `clsx` + `tailwind-merge` utility
- `.env.example` with all required vars documented

### Phase 1 — Data Model

- Write full `prisma/schema.prisma` (6 models, 2 enums, all indexes)
- `prisma migrate dev --name init`
- `types/metrics.ts`, `types/api.ts`, `types/auth.ts`
- `lib/validation/schemas.ts` — all Zod schemas
- `prisma/seed.ts` — dev user + 2 repos + 30 days of sample Metric rows

### Phase 2 — Auth System

- `lib/crypto/tokenEncryption.ts` — AES-256-GCM + HKDF
- `lib/auth/password.ts` — bcrypt hash/compare
- `lib/auth/jwt.ts` — sign/verify/hash
- `lib/auth/middleware.ts` — `withAuth` wrapper
- `lib/ratelimit.ts` — in-memory LRU sliding window
- 4 API route files: `register`, `login`, `logout`, `me`
- Unit tests for all `lib/auth/*` and `lib/crypto/*`
- CSRF double-submit cookie setup in `middleware.ts`

### Phase 3 — Repo Management + MCP

- `lib/github/mcpClient.ts` — MCP tool call wrapper
- `lib/github/rateLimitCache.ts` — per-token rate limit state
- 3 API routes: `GET /api/repos`, `POST /api/repos/connect`, `DELETE /api/repos/:id`
- Integration tests for all repo endpoints

### Phase 4 — Metrics Sync Engine

- `lib/metrics/transformers.ts` — pure transform functions + unit tests
- `lib/github/syncEngine.ts` — full sync orchestration
- `POST /api/sync/:repoId`, `GET /api/metrics/:repoId`, `GET /api/dashboard`
- Integration tests for metrics and dashboard endpoints

### Phase 5 — Frontend

| Sub-phase | Work | Time |
|-----------|------|------|
| 5a | UI primitives (Button, Input, Card, Badge, Select, DateRangePicker, Spinner, ErrorBoundary) | 4 h |
| 5b | Auth pages (LoginPage, RegisterPage, forms, `useAuth` hook) | 3 h |
| 5c | Layout + navigation (DashboardLayout, Sidebar, TopBar, auth guard) | 3 h |
| 5d | Repo management UI (ReposPage, RepoCard, ConnectRepoModal, `useRepos` hook) | 4 h |
| 5e | Chart components (4 Recharts components, loading/empty states) | 6 h |
| 5f | Dashboard + activity feed (DashboardPage, ActivityFeed, `useDashboard`/`useMetrics` hooks) | 4 h |

### Phase 6 — Testing

- Docker Compose (`docker-compose.test.yml`) with PostgreSQL service
- MSW handlers for all endpoints in `__tests__/mocks/handlers.ts`
- Fill integration test gaps; complete component and E2E tests
- Coverage report via `vitest --coverage`; target: `lib/` > 90%, API routes > 85%

### Phase 7 — CI/CD

`.github/workflows/ci.yml`:
```
on: [push, pull_request] targeting main
jobs:
  test     → pnpm test + pnpm test:int (postgres service container)
  build    → pnpm build (needs: test)
  security → pnpm audit --audit-level=high (needs: test)

.github/workflows/deploy.yml:
  on: push to main (needs: ci workflow)
```

### Phase 8 — Security Hardening

- All security response headers in `middleware.ts`
- ESLint rules: no `any`, no `dangerouslySetInnerHTML`, no `$queryRaw` string concat
- `next.config.ts`: `poweredByHeader: false`, `reactStrictMode: true`
- Session cleanup route: `GET /api/internal/cleanup-sessions` (scheduled via GitHub Actions cron)
- Lighthouse audit: performance, accessibility, best practices all ≥ 80

---

## 4. Scope Boundaries

The following are **explicitly excluded** from DevPulse. Work touching these areas requires a deliberate scope decision before starting.

| # | Out of Scope | Reason / Note |
|---|--------------|---------------|
| 1 | **GitLab, Bitbucket, Azure DevOps** | GitHub-only via MCP; multi-provider VCS adds significant complexity |
| 2 | **Real-time WebSocket data streaming** | Metrics are fetched on-demand or via manual sync; no GitHub webhook ingestion |
| 3 | **Code quality analysis** | No linting scores, cyclomatic complexity, or static analysis of repo source code |
| 4 | **GitHub Issues / Jira / Linear integration** | Ticket-level tracking is out of scope; only commits and PRs |
| 5 | **Billing, seat limits, subscription tiers** | DevPulse is a self-hosted single-org tool; no payment flows |
| 6 | **Native mobile app** | Responsive web app only; no iOS or Android |
| 7 | **AI-generated insights or summaries** | No LLM integration in the initial build |
| 8 | **Multi-tenancy / SaaS mode** | No tenant isolation; one deployment = one organisation |
| 9 | **Data export (CSV / PDF)** | No export functionality in v1 |
| 10 | **Notifications** | No email, Slack, or webhook alerts when metrics cross thresholds |
| 11 | **Custom dashboards / drag-and-drop layout** | Fixed dashboard layout only |
| 12 | **Historical data backfill beyond 30 days** | First sync fetches last 30 days; older data is not backfilled |
| 13 | **Team/organisation management** | No user roles beyond per-repo owner/viewer; no admin panel |
| 14 | **OAuth app flow** | GitHub PAT only; no GitHub OAuth app or installation tokens |

---

## 5. Success Criteria

The project is considered **complete** when all of the following are verified:

### Functional

- [ ] **US-01** A new user can register with email + password and land on the dashboard
- [ ] **US-02** A returning user can log in, remain logged in for 7 days, and log out
- [ ] **US-03** A user can connect a GitHub repo with a PAT; the token is encrypted in the DB
- [ ] **US-04** Commit frequency chart renders with real data from a connected repo
- [ ] **US-05** PR stats chart renders open/merged/closed lines with correct counts
- [ ] **US-06** Activity timeline renders push event density for the selected date range
- [ ] **US-07** Contributor chart ranks real contributors from synced data
- [ ] **US-08** Activity feed shows the 20 most recent events across connected repos
- [ ] **US-09** "Sync Now" triggers a sync; status updates from PENDING → SUCCESS
- [ ] **US-10** Disconnecting a repo removes it and its metrics from the user's view
- [ ] **US-11** Dashboard summary cards display correct totals across all connected repos

### Technical

- [ ] `pnpm build` completes with zero TypeScript errors (`strict: true`)
- [ ] `pnpm test` (unit + component) passes with coverage: `lib/` ≥ 90%, API routes ≥ 85%
- [ ] `pnpm test:int` (integration, requires Docker Postgres) passes with all routes covered
- [ ] `pnpm test:e2e` (Playwright) completes login, connect-repo, and dashboard flows
- [ ] `pnpm audit --audit-level=high` reports zero high or critical vulnerabilities
- [ ] GitHub Actions CI pipeline runs green on a test PR to `main`
- [ ] Lighthouse scores on `/dashboard`: Performance ≥ 80, Accessibility ≥ 90, Best Practices ≥ 90

### Security

- [ ] GitHub tokens in the DB are AES-256-GCM encrypted (verify: no plain text in `github_token_enc` column)
- [ ] JWT secret and encryption key are only present in environment variables, never in code
- [ ] All mutating API routes reject requests without a valid `X-CSRF-Token` header
- [ ] `GET /api/auth/me` with an expired session returns 401, not cached user data
- [ ] `Content-Security-Policy`, `X-Frame-Options`, and `X-Content-Type-Options` headers present on all responses

### Data Integrity

- [ ] Two consecutive syncs of the same repo do not create duplicate Metric rows (upsert semantics)
- [ ] `SyncLog.last_synced_at` advances on each successful sync
- [ ] Disconnecting a repo when another user has it connected does not delete the Repository or its Metrics

---

## 6. Grading Rubric Cross-Reference

Each row uses the exact rubric item name from the certification. **All 8 items are covered** — the table below shows where in this spec and which implementation files serve as proof.

| Rubric Item | Covered? | Spec Section | Proof / Evidence |
|-------------|----------|--------------|------------------|
| **5+ API endpoints** | ✓ | §2.2 API Contracts | 10 endpoints defined: `POST /api/auth/register`, `POST /api/auth/login`, `DELETE /api/auth/logout`, `GET /api/auth/me`, `GET /api/repos`, `POST /api/repos/connect`, `DELETE /api/repos/:id`, `GET /api/metrics/:repoId`, `GET /api/dashboard`, `POST /api/sync/:repoId`. Files: `app/api/*/route.ts` |
| **3+ related tables** | ✓ | §2.1 Data Model | 6 related models in `prisma/schema.prisma`: `User → Session` (1:many), `User → UserRepository → Repository` (many:many via join table), `Repository → Metric` (1:many), `Repository → SyncLog` (1:many). All have explicit foreign keys, `@relation` decorators, and referential actions (`onDelete: Cascade`). |
| **5+ frontend components** | ✓ | §2.3 Component Tree | 24 named components across 5 groups — Pages: `LoginPage`, `RegisterPage`, `DashboardPage`, `ReposPage`, `SettingsPage`; Charts: `CommitFrequencyChart`, `PRStatsChart`, `ContributorChart`, `ActivityTimeline`; Feed: `ActivityFeed`, `ActivityFeedItem`; Repos: `RepoCard`, `RepoSelector`, `ConnectRepoModal`; UI Primitives: `Button`, `Input`, `Card`, `Badge`, `Select`, `DateRangePicker`, `Spinner`, `ErrorBoundary`; Layouts: `AuthLayout`, `DashboardLayout`. Files: `components/`, `app/` |
| **80%+ test coverage** | ✓ | §5 Success Criteria (Technical) | Target: `lib/` ≥ 90%, API routes ≥ 85% — enforced by `vitest --coverage` in CI. 4 test layers: unit (Vitest), integration (Vitest + real Postgres), component (RTL + MSW), E2E (Playwright). Files: `__tests__/`, `e2e/`, `vitest.config.ts`, `playwright.config.ts` |
| **CI/CD pipeline** | ✓ | §3 Phase 7 | GitHub Actions with 3 ordered jobs on every PR: **test** (unit + integration with Postgres service container) → **build** (`pnpm build`) → **security** (`pnpm audit --audit-level=high`). Separate deploy workflow fires only on merge to `main`. Files: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` |
| **Security audit** | ✓ | §5 Success Criteria (Security) | 5 auditable security checks: (1) AES-256-GCM token encryption verified in DB, (2) secrets only in env vars, (3) CSRF header required on all mutations, (4) expired sessions return 401, (5) CSP + `X-Frame-Options` + `X-Content-Type-Options` on all responses. Phase 8 runs `pnpm audit` and Lighthouse. Files: `lib/auth/`, `lib/crypto/`, `middleware.ts` |
| **MCP integration** | ✓ | §3 Phase 3–4 | GitHub MCP server (`mcp__github__*`) used for: repo validation on connect (`search_repositories`), commit ingestion (`list_commits` with `since` cursor), PR ingestion (`list_pull_requests`). Sync flow: MCP call → `lib/metrics/transformers.ts` → `prisma.metric.upsert`. Files: `lib/github/mcpClient.ts`, `lib/github/syncEngine.ts` |
| **Documentation** | ✓ | §4 Scope Boundaries; §5 Success Criteria | Three documentation artifacts: `CLAUDE.md` (architecture, conventions, scope), `docs/SPEC.md` (this file — requirements, design, plan, rubric), `.env.example` (all required env vars with comments). In-code comments follow "WHY not WHAT" policy from `CLAUDE.md`. |

### Grading Scale

| Score | Meaning |
|-------|---------|
| 90–100 | All 8 rubric items fully satisfied; all §5 success criteria checked; CI green; no high-severity security issues |
| 75–89 | Core user stories complete (US-01–US-05, US-09, US-11); ≥ 5 rubric items fully satisfied; minor gaps in coverage or security |
| 60–74 | Auth + at least one data source working; basic frontend rendering; CI pipeline present; some tests |
| Below 60 | Incomplete core functionality, missing CI/CD, or critical security vulnerabilities |

### Quick Rubric Status Summary

```
✓  5+ API endpoints       — 10 endpoints across auth, repos, metrics, sync, dashboard
✓  3+ related tables      — 6 models: User, Session, Repository, UserRepository, Metric, SyncLog
✓  5+ frontend components — 24 components across pages, charts, feed, repo management, UI primitives
✓  80%+ test coverage     — lib/ ≥ 90%, API routes ≥ 85%, enforced in CI via vitest --coverage
✓  CI/CD pipeline         — GitHub Actions: test → build → security (PR) + deploy (main)
✓  Security audit         — pnpm audit + 5 runtime security checks in §5 + Phase 8 hardening
✓  MCP integration        — GitHub MCP for repo validation, commit sync, and PR sync
✓  Documentation          — CLAUDE.md + docs/SPEC.md + .env.example
```

---

*This specification is the authoritative reference for the DevPulse capstone project. Deviations from this document require an explicit note in the PR description explaining the rationale.*
