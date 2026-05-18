# DevPulse

Developer analytics dashboard that connects to GitHub repositories and surfaces commit frequency, pull request statistics, and team activity over time.

---

## Quick Start

Requires Node.js 20+, npm, and a running PostgreSQL instance.

```bash
# 1. Clone the repository
git clone https://github.com/Vicknesb/MyAITaskCapestone.git
cd MyAITaskCapestone
```

```bash
# 2. Create your local environment file
cp .env.example .env
```

Open `.env` and set at minimum:
- `DATABASE_URL` — your PostgreSQL connection string
- `TEST_DATABASE_URL` — a separate database for tests
- `JWT_SECRET` — any long random string (≥ 32 chars)
- `ENCRYPTION_KEY` — base64-encoded 32-byte key (see comment in `.env.example` for the generation command)

```bash
# 3. Install dependencies
npm install
# Expected: added NNN packages, found 0 vulnerabilities
```

```bash
# 4. Run database migrations
npx prisma migrate dev
# Expected: Applied 1 migration(s), Generated Prisma Client
```

```bash
# 5. (Optional) Load sample data with two users and three repositories
npm run db:seed
# Expected:
#   ✓  Created 2 users
#   ✓  Created 3 repositories
#   ✓  Created 5 user-repository links
#   ✓  Created 60 metric snapshots
#   ✅  Seed complete.
#
#   Users:
#     alice@devpulse.dev  /  Password123!
#     bob@devpulse.dev    /  Password123!
```

```bash
# 6. Start the Express API server (Terminal 1)
npm run dev:api
# Expected: DevPulse API running on http://localhost:4000
```

```bash
# 7. Start the Next.js frontend (Terminal 2)
npm run dev
# Expected: ▲ Next.js 15.x.x — ready on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000). Register an account or log in with a seed user, then connect a GitHub repository using a personal access token.

---

## Architecture

```
Browser
  │
  ├─ Next.js Edge Middleware (middleware.ts)
  │    Security headers on every response
  │    Route guard: /dashboard, /repos, /settings → /login if no session cookie
  │
  ├─ Next.js App Router (port 3000)
  │    app/(auth)/login        → login page
  │    app/(auth)/register     → register page
  │    app/(dashboard)/        → protected dashboard shell + pages
  │    lib/apiClient.ts        → fetch wrapper (reads Bearer token from localStorage)
  │    hooks/use*.ts           → TanStack Query hooks per resource
  │
  │    /api/* rewrites → http://localhost:4000/api/*   (next.config.ts)
  │
  └─ Express API Server (port 4000)
       src/app.ts              → CORS, JSON body, cookie-parser, router mounts
       src/middleware/authenticate.ts  → JWT verify → session DB lookup
       src/routes/auth.ts      → POST /api/auth/register|login, GET /me, DELETE /logout
       src/routes/repos.ts     → CRUD for connected repositories + file browser
       src/routes/metrics.ts   → per-repo metrics queries
       src/routes/dashboard.ts → aggregate metrics across all user repos
       src/routes/sync.ts      → trigger background GitHub data sync
       src/lib/github/syncEngine.ts  → GitHub REST API pagination + metric upserts
            │
            └─ Prisma ORM → PostgreSQL
                 users, sessions, repositories, user_repositories, metrics, sync_logs
```

All `/api/*` traffic from the browser hits Next.js first, which rewrites the request to the Express server. The Next.js layer never touches the database directly.

---

## Project Structure

```
my-capstone/
├── app/                        Next.js App Router pages and layouts
│   ├── (auth)/                 Public routes: /login, /register
│   ├── (dashboard)/            Protected routes: /dashboard, /repos, /settings
│   ├── layout.tsx              Root layout — wraps with TanStack Query provider
│   └── providers.tsx           QueryClientProvider with default staleTime of 30s
│
├── components/
│   ├── charts/                 Recharts wrappers: CommitFrequencyChart, PRStatsChart,
│   │                           ActivityTimeline, ContributorChart
│   ├── feed/                   ActivityFeed and ActivityFeedItem
│   ├── repos/                  RepoCard, ConnectRepoModal
│   └── ui/                     Primitives: Button, Card, Input, Badge, Spinner, ErrorBoundary
│
├── hooks/                      React Query hooks for each resource
│   ├── useAuth.ts              login, register, logout, current user
│   ├── useRepos.ts             list, connect, disconnect, sync
│   ├── useMetrics.ts           per-repo metrics with date/type filters
│   └── useDashboard.ts         aggregate summary across all repos
│
├── lib/
│   ├── apiClient.ts            fetch wrapper — attaches Bearer token, unwraps ApiResponse
│   └── cn.ts                   clsx + tailwind-merge helper
│
├── src/                        Express API server
│   ├── app.ts                  Express app — CORS, middleware, route mounts
│   ├── server.ts               Entry point — dotenv + app.listen
│   ├── routes/                 One file per resource group
│   ├── middleware/authenticate.ts  JWT + session validation
│   └── lib/
│       ├── auth/               hashPassword, comparePassword, signToken, verifyToken
│       ├── crypto/             AES-256-GCM encrypt/decrypt for GitHub tokens (HKDF per-repo key)
│       ├── db.ts               Prisma client singleton
│       ├── github/             fetchRepoMeta (REST), syncEngine (paginated commits + PRs)
│       ├── metrics/            transformers: commits/PRs → typed metric payloads
│       └── validation/         Zod schemas for all request bodies and query params
│
├── types/                      Shared TypeScript types (ApiResponse, JWTPayload, MetricPayload)
│
├── prisma/
│   ├── schema.prisma           Source of truth for all models
│   ├── seed.ts                 Seeds 2 users, 3 repos, 5 weeks of metrics
│   └── migrations/             Auto-generated SQL — never hand-edit
│
├── __tests__/                  Integration tests (require TEST_DATABASE_URL)
│   └── helpers.ts              resetDb, teardown, createAuthUser
│
├── .github/workflows/ci.yml    Test → Build → Security pipeline
└── docs/
    ├── API.md                  Complete API reference
    ├── SPEC.md                 Original project specification
    └── SECURITY-AUDIT.md       Security audit findings and applied fixes
```

---

## Environment Variables

All variables are read at runtime by the Express API server (`src/server.ts` loads `.env` via dotenv).

| Variable | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string for Prisma | `postgresql://user:pass@localhost:5432/devpulse` |
| `TEST_DATABASE_URL` | Yes (tests) | Separate PostgreSQL DB used by Vitest | `postgresql://user:pass@localhost:5432/devpulse_test` |
| `JWT_SECRET` | Yes | Signs and verifies JWT session tokens — keep secret | `a-long-random-string-minimum-32-chars` |
| `ENCRYPTION_KEY` | Yes | Base64-encoded 32-byte key for AES-256-GCM encryption of stored GitHub tokens | `<output of crypto.randomBytes(32).toString('base64')>` |
| `PORT` | No | Express API listen port (default: `3000`) | `4000` |
| `ALLOWED_ORIGIN` | No | CORS allowed origin (default: `http://localhost:3000`) | `https://devpulse.example.com` |
| `API_URL` | No | Next.js rewrites `/api/*` to this base URL (default: `http://localhost:4000`) | `http://localhost:4000` |
| `NODE_ENV` | No | Controls secure cookie flag and Prisma query logging | `production` |

Generate `ENCRYPTION_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Available Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start Next.js development server on port 3000 |
| `npm run dev:api` | Start Express API server on port 4000 (ts-node) |
| `npm run build` | Next.js production build |
| `npm start` | Start Next.js production server (run `build` first) |
| `npm test` | Run all Vitest tests (requires `TEST_DATABASE_URL`) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Run tests with v8 coverage (thresholds: 80% statements/functions/lines) |
| `npm run typecheck` | TypeScript type check without emitting (`tsc --noEmit`) |
| `npm run lint` | ESLint via `next lint` |
| `npm run db:migrate` | Apply pending Prisma migrations to `DATABASE_URL` |
| `npm run db:seed` | Reset and re-seed the database with sample data |
| `npm run db:studio` | Open Prisma Studio GUI at http://localhost:5555 |
| `npm run db:reset` | Drop and recreate the database, re-apply all migrations |

---

## Tech Stack

| Package | Version | Purpose |
|---|---|---|
| `next` | ^15.5.18 | React framework — App Router, edge middleware, production server |
| `react` / `react-dom` | ^19.2.6 | UI rendering |
| `typescript` | ^6.0.3 | Static typing across the entire codebase |
| `express` | ^5.2.1 | API server — handles all `/api/*` requests |
| `prisma` / `@prisma/client` | ^6.19.3 | ORM and query builder for PostgreSQL |
| `jsonwebtoken` | ^9.0.3 | JWT signing and verification |
| `bcryptjs` | ^3.0.3 | bcrypt password hashing (cost factor 12) |
| `zod` | ^4.4.3 | Request body and query param validation schemas |
| `express-rate-limit` | ^7.5.1 | Rate limiting for auth endpoints |
| `@tanstack/react-query` | ^5.100.10 | Server-state management and caching in the frontend |
| `recharts` | ^3.8.1 | SVG chart components (bar, area, pie) |
| `tailwindcss` | ^3.4.19 | Utility-first CSS |
| `tailwind-merge` + `clsx` | ^3.6.0 / ^2.1.1 | Conditional Tailwind class composition via `cn()` |
| `react-hook-form` | ^7.76.0 | Form state management with Zod resolver |
| `vitest` | ^3.2.4 | Test runner |
| `@vitest/coverage-v8` | ^3.2.4 | V8 native code coverage |
| `supertest` | ^7.2.2 | HTTP integration testing against Express app |
| `dotenv` | ^17.4.2 | `.env` loading in the Express server |
| `cors` | ^2.8.6 | Express CORS middleware |
| `cookie-parser` | ^1.4.7 | Cookie parsing for session cookies in Express |

---

## Database Schema

Six tables managed by Prisma:

```
users ──────────────────┐
  id (cuid)             │ has many
  email (unique)        │
  password_hash         ├── sessions
  name?                 │     id, user_id, token_hash (unique), expires_at
  created_at            │
  updated_at            │
                        └── user_repositories (join table)
                                user_id, repository_id (unique pair), role
                                       │
                               repositories
                                 id, github_repo_id (unique), full_name, owner
                                 github_token_enc, token_iv, token_tag  ← AES-256-GCM
                                       │
                               ┌───────┴──────────────────┐
                            metrics                    sync_logs
                              repository_id              repository_id
                              type (enum)                status (PENDING|RUNNING|SUCCESS|FAILED)
                              recorded_at                triggered_by, started_at, finished_at
                              period_days (7 or 30)      items_fetched, github_rate_remaining
                              payload (JSON)             error_message?
```
