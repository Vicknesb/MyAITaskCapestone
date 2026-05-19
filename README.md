# DevPulse

Developer analytics dashboard that connects to GitHub repositories and surfaces commit frequency, pull request statistics, and team activity over time.

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| Node.js | 20.x | Check with `node --version` |
| npm | 10.x | Bundled with Node 20 |
| PostgreSQL | 14+ | Two databases needed: one for dev, one for tests |
| Git | any | — |

You will also need a **GitHub Personal Access Token** (PAT) with `repo` scope to connect repositories inside the app. Generate one at [github.com/settings/tokens](https://github.com/settings/tokens).

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/Vicknesb/MyAITaskCapestone.git
cd MyAITaskCapestone
npm install
```

Expected output ends with: `added NNN packages, found 0 vulnerabilities`

---

### 2. Create the environment file

```bash
cp .env.example .env
```

Open `.env` and fill in the four required values:

```bash
# PostgreSQL connection strings
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/devpulse"
TEST_DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/devpulse_test"

# JWT secret — any random string ≥ 32 characters
JWT_SECRET="replace-with-a-long-random-string-at-least-32-chars"

# AES-256-GCM key for encrypting stored GitHub tokens — generate with:
# node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ENCRYPTION_KEY="<output of the command above>"
```

Generate `ENCRYPTION_KEY` in one step:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> **Both databases must exist before running migrations.** Create them first:
> ```sql
> CREATE DATABASE devpulse;
> CREATE DATABASE devpulse_test;
> ```

---

### 3. Run database migrations

```bash
npx prisma migrate dev
```

Expected: `Applied 1 migration(s)` and `Generated Prisma Client`

---

### 4. (Optional) Load sample data

```bash
npm run db:seed
```

Expected output:
```
✓  Created 2 users
✓  Created 3 repositories
✓  Created 5 user-repository links
✓  Created 60 metric snapshots
✅  Seed complete.

Users:
  alice@devpulse.dev  /  Password123!
  bob@devpulse.dev    /  Password123!
```

---

### 5. Start both servers

Open two terminal tabs:

**Terminal 1 — Express API (port 4000)**
```bash
npm run dev:api
# Expected: DevPulse API running on http://localhost:4000
```

**Terminal 2 — Next.js frontend (port 3000)**
```bash
npm run dev
# Expected: ▲ Next.js 15.x.x — ready on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000). Register an account (or log in with a seed user), then click **Connect Repository** and paste your GitHub PAT to start syncing metrics.

---

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Error: JWT_SECRET is required` on API start | `.env` not loaded or variable missing | Confirm `.env` exists in the project root and `JWT_SECRET` is set |
| `Error: ENCRYPTION_KEY is required` | Same as above | Generate and set `ENCRYPTION_KEY` (step 2) |
| Prisma migration fails with "database does not exist" | Databases not created yet | Run the `CREATE DATABASE` commands in psql first |
| `connect ECONNREFUSED 127.0.0.1:4000` in browser | Express API not running | Start `npm run dev:api` in a second terminal |
| `VALIDATION_ERROR` when connecting a repo | PAT too short or wrong format | GitHub PATs start with `ghp_` and are 40+ characters |
| Tests fail with `TEST_DATABASE_URL` missing | Env var not set | Add `TEST_DATABASE_URL` to `.env` and run `npx prisma migrate dev` against the test DB |

---

## Architecture

### System overview

```mermaid
flowchart TD
    Browser["Browser"]

    subgraph Next.js ["Next.js  (port 3000)"]
        MW["Edge Middleware\n• Security headers\n• Session cookie guard"]
        AR["App Router\n• /login  /register\n• /dashboard  /repos  /settings"]
        AC["apiClient.ts\nfetch wrapper — credentials:include"]
        HK["TanStack Query hooks\nuseAuth · useRepos · useMetrics · useDashboard"]
    end

    subgraph Express ["Express API  (port 4000)"]
        AUTH["src/routes/auth.ts\nregister · login · me · logout"]
        REPOS["src/routes/repos.ts\nlist · connect · disconnect · files"]
        METRICS["src/routes/metrics.ts\nper-repo metric queries"]
        DASH["src/routes/dashboard.ts\naggregate summary"]
        SYNC["src/routes/sync.ts\ntrigger background sync"]
        SE["syncEngine.ts\nGitHub REST pagination\nupsert metrics"]
        AMW["authenticate middleware\nJWT verify → session DB lookup"]
    end

    subgraph Data ["Data layer"]
        PG[("PostgreSQL\nusers · sessions\nrepositories · metrics\nsync_logs")]
    end

    GH["GitHub REST API"]

    Browser -->|page request| MW
    MW -->|protected route, no cookie| Browser
    MW -->|allowed| AR
    AR -->|API calls via fetch| AC
    AC -->|"/api/* rewrite"| Express
    HK --> AC

    Express --> AMW
    AMW --> AUTH
    AMW --> REPOS
    AMW --> METRICS
    AMW --> DASH
    AMW --> SYNC
    SYNC -->|setImmediate| SE
    SE -->|paginated fetch| GH
    SE --> PG
    AUTH --> PG
    REPOS --> PG
    METRICS --> PG
    DASH --> PG
```

---

### Authentication flow

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant Next.js
    participant Express
    participant DB as PostgreSQL

    User->>Browser: POST /api/auth/login (email + password)
    Browser->>Next.js: fetch /api/auth/login
    Next.js->>Express: rewrite → POST :4000/api/auth/login
    Express->>DB: SELECT user WHERE email = ?
    DB-->>Express: user row
    Express->>Express: bcrypt.compare(password, hash)
    Express->>DB: INSERT session (token_hash, expires_at)
    DB-->>Express: session row
    Express-->>Next.js: 200 { user } + Set-Cookie: devpulse_session (httpOnly)
    Next.js-->>Browser: response + cookie
    Browser->>Browser: cookie stored automatically by browser

    Note over Browser,Express: Subsequent API calls

    Browser->>Next.js: GET /api/repos (cookie sent automatically)
    Next.js->>Express: rewrite → GET :4000/api/repos
    Express->>Express: authenticate middleware:\n1. read devpulse_session cookie\n2. hash token → lookup sessions table\n3. set req.userId
    Express->>DB: SELECT repositories WHERE user_id = ?
    DB-->>Express: repo rows
    Express-->>Browser: 200 { repositories }
```

---

### Sync engine data flow

```mermaid
flowchart LR
    A["POST /api/sync/:repoId"] --> B["Create SyncLog\nstatus: PENDING"]
    B --> C["Return 202 Accepted"]
    B --> D["setImmediate — background"]
    D --> E["Decrypt GitHub token\nAES-256-GCM"]
    E --> F["GET /repos/owner/repo/commits\npaginated, max 10 pages"]
    E --> G["GET /repos/owner/repo/pulls\npaginated, max 10 pages"]
    F --> H["transformCommits()\ntransformToActivityPayload()"]
    G --> I["transformPRs()\nderiveContributors()"]
    H --> J["prisma.metric.upsert\n×4 types ×2 periods"]
    I --> J
    J --> K["SyncLog → SUCCESS"]
    D -->|"catch"| L["SyncLog → FAILED\nerror_message saved"]
```

---

### Database schema

```mermaid
erDiagram
    users {
        string id PK
        string email UK
        string password_hash
        string name
        datetime created_at
        datetime updated_at
    }
    sessions {
        string id PK
        string user_id FK
        string token_hash UK
        datetime expires_at
        string user_agent
        string ip_address
    }
    repositories {
        string id PK
        int github_repo_id UK
        string full_name
        string owner
        string name
        string github_token_enc
        string token_iv
        string token_tag
        bool is_private
        string default_branch
    }
    user_repositories {
        string id PK
        string user_id FK
        string repository_id FK
        string role
        datetime connected_at
    }
    metrics {
        string id PK
        string repository_id FK
        string type
        datetime recorded_at
        int period_days
        json payload
    }
    sync_logs {
        string id PK
        string repository_id FK
        string status
        string triggered_by
        datetime started_at
        datetime finished_at
        int items_fetched
        string error_message
    }

    users ||--o{ sessions : "has"
    users ||--o{ user_repositories : "connects"
    repositories ||--o{ user_repositories : "connected by"
    repositories ||--o{ metrics : "has"
    repositories ||--o{ sync_logs : "has"
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
│   ├── apiClient.ts            fetch wrapper — credentials:include, unwraps ApiResponse envelope
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
