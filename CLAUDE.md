# DevPulse — Developer Analytics Dashboard

## Project Description

DevPulse is an internal developer analytics dashboard that connects to GitHub repositories and surfaces commit frequency, pull request statistics, and team activity over time. It is designed as an engineering-team tool: self-hosted, authenticated, and focused on actionable metrics rather than vanity numbers.

The primary user is an engineering lead or team member who wants a quick view of repository health and contributor activity without switching to GitHub's native interface.

---

## Architecture Overview

DevPulse is a **dual-server application**. The Next.js frontend (port 3000) and the Express API server (port 4000) run as separate processes. Next.js rewrites all `/api/*` traffic to Express via `next.config.ts`.

```
Browser
  │
  ├─ Next.js Edge Middleware (middleware.ts)
  │    Runs on every request: sets security headers (CSP, X-Frame-Options, etc.)
  │    Route guard: redirects /dashboard|/repos|/settings → /login if no session cookie
  │
  ├─ Next.js App Router  (port 3000)
  │    app/(auth)/          → /login, /register  (public)
  │    app/(dashboard)/     → /dashboard, /repos, /settings  (client auth guard)
  │    lib/apiClient.ts     → fetch wrapper, attaches Bearer token from localStorage
  │    hooks/use*.ts        → TanStack Query hooks per resource
  │
  │    /api/* → rewrite → http://localhost:4000/api/*  (next.config.ts)
  │
  └─ Express API  (port 4000)
       src/app.ts                → CORS (ALLOWED_ORIGIN), JSON body, cookie-parser
       src/middleware/authenticate.ts → JWT verify → SHA-256 hash → sessions table lookup
       src/routes/auth.ts        → /api/auth/* (register, login, me, logout)
       src/routes/repos.ts       → /api/repos/* (list, connect, disconnect, file browser)
       src/routes/metrics.ts     → /api/metrics/:repoId
       src/routes/dashboard.ts   → /api/dashboard
       src/routes/sync.ts        → /api/sync/:repoId  (fire-and-forget background job)
       src/lib/github/syncEngine.ts → GitHub REST pagination → Prisma metric upserts
            │
            └─ Prisma ORM → PostgreSQL
                 users, sessions, repositories, user_repositories, metrics, sync_logs
```

### Data Flow

1. **Auth:** Client POSTs credentials → Express hashes password (bcrypt, cost 12) → creates `Session` row with `token_hash` → returns JWT in response body and sets `devpulse_session` httpOnly cookie.
2. **API calls:** Client reads JWT from `localStorage`, attaches as `Authorization: Bearer <token>` → `authenticate` middleware hashes the incoming token and looks it up in `sessions` → sets `req.userId` and `req.sessionId`.
3. **Connect repo:** Client POSTs `{ full_name, github_token }` → Express validates token live against GitHub → AES-256-GCM encrypts token (per-repo HKDF derived key) → stores ciphertext in `repositories`.
4. **Sync:** `POST /api/sync/:repoId` returns 202 immediately → `setImmediate` runs `runSync()` in background → fetches commits and PRs from GitHub (paginated, max 1,000 items each) → upserts `Metric` rows for 7-day and 30-day windows.
5. **Dashboard:** `GET /api/dashboard` reads latest `Metric` rows for all connected repos → aggregates cross-repo summary → returns `per_repo` array with most recent payload per metric type.

### Key External Dependencies

| Concern | Library |
|---|---|
| UI framework | Next.js 15 (App Router) |
| Language | TypeScript (strict mode) |
| Database ORM | Prisma |
| Database | PostgreSQL |
| Styling | Tailwind CSS |
| Charts | Recharts |
| GitHub data | GitHub MCP server |
| Auth | Custom JWT sessions (no NextAuth unless added) |
| CI/CD | GitHub Actions |

---

## Coding Conventions

### Naming

| Artifact | Convention | Example |
|---|---|---|
| Files (components) | PascalCase | `CommitChart.tsx` |
| Files (utilities) | camelCase | `githubClient.ts` |
| Files (routes) | lowercase kebab | `app/repos/[id]/page.tsx` |
| React components | PascalCase | `ActivityFeed` |
| Functions | camelCase | `fetchRepoMetrics()` |
| Constants | SCREAMING_SNAKE | `MAX_REPOS_PER_USER` |
| DB models (Prisma) | PascalCase singular | `User`, `Repository`, `Metric` |
| DB columns | snake_case | `created_at`, `repo_id` |
| API routes | REST, lowercase | `/api/metrics/:repoId` |
| CSS classes | Tailwind utilities only — no custom class names unless using `@layer components` |

### TypeScript

- `strict: true` is non-negotiable. No `any`; use `unknown` and narrow.
- Define shared types in `types/`. Do not inline complex types inside components.
- Prefer `type` over `interface` unless declaration merging is needed.
- All API route handlers must type both the request body and the response shape.
- Prisma-generated types are the source of truth for DB shapes — do not duplicate them.

### File Structure Rules

- One component per file. No barrel files (`index.ts`) in `components/` — import by full path.
- API route files export only: `GET`, `POST`, `PUT`, `DELETE` (Next.js App Router conventions).
- `lib/` modules must be pure and side-effect-free; initialize clients in a singleton pattern.
- Server-only code (Prisma, secrets) must not be imported in client components. Use `"use server"` or API routes as the boundary.

### Styling

- Tailwind CSS only. No CSS Modules, no inline `style={}` except for dynamic values that Tailwind cannot express (e.g., chart colors).
- Responsive design is required for all dashboard views (mobile-first breakpoints).
- Use `cn()` (clsx + tailwind-merge) for conditional class composition.

### Comments

- Do not comment what the code does — name things clearly instead.
- Add a comment only when the WHY is non-obvious: a hidden invariant, a workaround for a specific GitHub API quirk, an intentional performance trade-off.

---

## Database Schema (Prisma)

Core tables and relationships:

```
User         → has many Session
User         → has many Repository (through UserRepository join)
Repository   → has many Metric
Metric       → belongs to Repository, has type enum (COMMIT_FREQ | PR_STATS | ACTIVITY)
```

Rules:
- All migrations go through `prisma migrate dev` — never edit the DB directly.
- Seed data lives in `prisma/seed.ts`.
- Never store raw GitHub tokens in plain text; encrypt before persisting.

---

## API Design

All API responses follow this envelope:

```ts
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };
```

- `4xx` errors must include a human-readable `error` string.
- `5xx` errors must not leak stack traces to the client.
- Auth is required on all `/api/*` routes except `/api/auth/register` and `/api/auth/login`.
- Validate all request bodies with Zod before touching the DB.

---

## Testing Strategy

### Layers

| Layer | Tool | What to test |
|---|---|---|
| Unit | Vitest | Pure utility functions in `lib/`, type guards, data transformers |
| Integration | Vitest + Prisma test DB | API route handlers against a real PostgreSQL test database |
| Component | React Testing Library | Chart components, form inputs, conditional render paths |
| E2E (optional) | Playwright | Critical flows: login, connect repo, view dashboard |

### Rules

- Unit tests live next to the module: `lib/github/client.test.ts`.
- Integration tests live in `__tests__/api/`.
- Do not mock the database in integration tests — use a dedicated test database and reset it per test suite.
- Tests must pass before any merge to `main`. CI enforces this.
- Aim for high coverage on `lib/` and API routes; do not chase 100% coverage on presentational components.

### Running Tests

```bash
npm test                # all tests (requires TEST_DATABASE_URL)
npm run test:coverage   # with v8 coverage — thresholds: 80% statements/functions/lines
npm run test:watch      # watch mode during development
```

---

## CI/CD (GitHub Actions)

Pipeline stages run in order:

1. **Test** — `npm test` with a PostgreSQL 16 service container (`TEST_DATABASE_URL` set in workflow env)
2. **Build** — `npm run build` (Next.js production build, runs only after test passes)
3. **Security** — `npm audit --audit-level=high` (runs in parallel with test)
4. **Deploy** — only on merge to `main`; target environment is configured via repo secrets

Secrets required in GitHub Actions: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`.

CI config: `.github/workflows/ci.yml`

---

## Scope Boundaries — What DevPulse Does NOT Include

The following are explicitly out of scope. Do not implement them without a deliberate decision to expand the project:

- **Multi-provider VCS** — GitLab, Bitbucket, Azure DevOps are not supported. GitHub only.
- **Real-time WebSocket streaming** — metrics are fetched on demand or via polling. No live push from GitHub webhooks (can be added later, but not in initial scope).
- **Code quality analysis** — no linting scores, complexity metrics, or static analysis of repository code.
- **Issue tracking** — GitHub Issues, Jira, Linear, etc. are not integrated.
- **Billing or team management** — no seat limits, subscription tiers, or payment flows.
- **Mobile app** — the dashboard is a responsive web app, not a native iOS/Android application.
- **AI-generated insights** — no LLM-generated summaries or recommendations in the initial build.
- **Multi-tenancy / SaaS mode** — DevPulse is a single-organization self-hosted tool. There is no tenant isolation layer.
- **Data export** — no CSV/PDF export of metrics in the initial scope.
- **Notifications** — no email or Slack alerts when metrics cross thresholds.

If a feature request touches any item on this list, raise it explicitly before starting work so scope can be consciously expanded rather than accidentally grown.

---

## MCP Integration

### What MCP Is (and Is Not) at Runtime

The GitHub MCP server (`@modelcontextprotocol/server-github`) runs **only during Claude Code development sessions** — it is not available to the Express server at runtime. MCP tools are used during development to:

- Inspect real GitHub repository shapes to inform type definitions and transformers
- Validate API response structures before writing production code
- Explore the user's real repos and commits interactively

The Express sync engine (`src/lib/github/syncEngine.ts`) calls the **GitHub REST API directly** via `fetch`, using the decrypted per-repo GitHub token stored in the database.

### Project-level MCP Configuration

**File:** `.mcp.json` (project root — listed in `.gitignore`, never committed)

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-pat-here>"
      }
    }
  }
}
```

To enable: create `.mcp.json` at the project root with your PAT. Claude Code loads it automatically.

**Claude Code settings:** `.claude/settings.local.json` must include `"github"` in `enabledMcpjsonServers`.

### Available MCP Tools (dev session only)

| Tool | Usage in DevPulse |
|---|---|
| `mcp__github__search_repositories` | Discover repos; verify PAT scope |
| `mcp__github__list_commits` | Inspect real commit shapes (used to build `GitHubCommit` type) |
| `mcp__github__list_pull_requests` | Inspect real PR shapes (used to build `GitHubPR` type) |
| `mcp__github__get_file_contents` | Browse repo file contents during development |

### Confirmed GitHub API Response Shapes

These shapes were verified via live MCP calls and are the basis for the types in `src/lib/metrics/transformers.ts`:

**Commit** (`GET /repos/{owner}/{repo}/commits`):
```json
{
  "sha": "99fa8d3a...",
  "commit": {
    "author": { "name": "Vicknesb", "email": "...", "date": "2023-04-05T05:52:13Z" },
    "message": "..."
  },
  "author": { "login": "Vicknesb", "avatar_url": "https://avatars.githubusercontent.com/..." }
}
```

**Pull Request** (`GET /repos/{owner}/{repo}/pulls?state=all`):
```json
{
  "number": 1, "state": "closed", "title": "...",
  "created_at": "...", "merged_at": "...", "closed_at": "...",
  "user": { "login": "...", "avatar_url": "..." },
  "requested_reviewers": []
}
```

### Runtime Sync Flow

```
POST /api/sync/:repoId
  → creates SyncLog (PENDING)
  → setImmediate → runSync() [background, non-blocking]
      ├─ decryptToken(repo) → GitHub PAT
      ├─ GET /repos/{owner}/{repo}/commits?since=<last_synced_at>  (paginated, max 10 pages)
      ├─ GET /repos/{owner}/{repo}/pulls?state=all                 (paginated, max 10 pages)
      ├─ transformCommits() + transformPRs() + deriveContributors() + transformToActivityPayload()
      ├─ prisma.metric.upsert × 4 types × 2 periods (7d + 30d)
      └─ SyncLog → SUCCESS | FAILED
```

### File Browser Feature

`GET /api/repos/:id/files?path=&ref=` decrypts the repo's stored token and proxies the GitHub Contents API, returning the file/directory listing for any path in the connected repository. This is the "import files" feature — it gives the frontend the ability to display a live file tree of connected repos.

---

## Auth Pattern

### How a request is authenticated

1. Client sends `Authorization: Bearer <jwt>` (set by `lib/apiClient.ts` from `localStorage`).
2. `authenticate` middleware (`src/middleware/authenticate.ts`) calls `verifyToken(raw)` — this checks JWT signature and expiry.
3. The raw token is hashed with SHA-256: `hashToken(raw)`. The hash is looked up in `sessions.token_hash`. If no row exists, or `expires_at < now`, the session is rejected.
4. If fewer than 24 hours remain on the session, a new token is signed and returned via `Set-Cookie`. The `sessions` row is updated with the new hash and a new 7-day expiry (sliding window).
5. On success, `req.userId` and `req.sessionId` are set for the route handler.

### Which routes are protected

All Express routes except `POST /api/auth/register` and `POST /api/auth/login` pass through the `authenticate` middleware. The Next.js edge middleware (`middleware.ts`) additionally protects the `/dashboard`, `/repos`, and `/settings` page routes using the `devpulse_session` cookie — it redirects unauthenticated visits to `/login` before any React code runs.

### Token storage (dual-channel)

- **httpOnly cookie** (`devpulse_session`): set on login/register. Read only by the Next.js edge middleware for server-side route protection. Not accessible to JavaScript.
- **localStorage** (`devpulse_token`): written by `lib/apiClient.ts` → `setToken()`. Read on every API request to populate the `Authorization` header.

Both channels carry the same JWT value. A logout invalidates the server-side session; both channels should be cleared client-side.

---

## Database Pattern

### Prisma singleton

```ts
// src/lib/db.ts
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ ... });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

Import `prisma` from `../lib/db` in every route and module that needs DB access. Never instantiate `new PrismaClient()` anywhere else — this prevents connection pool exhaustion in both development (HMR) and production.

### Migration workflow

```bash
npx prisma migrate dev       # create and apply a new migration during development
npx prisma migrate deploy    # apply pending migrations in production / CI
npx prisma generate          # regenerate the Prisma client after schema changes
```

Never run `prisma migrate dev` in production — it can prompt interactively and will shadow-database. Use `migrate deploy`.

### Seeding

`prisma/seed.ts` creates 2 users, 3 repositories, 5 user-repository links, 60 metric snapshots (3 repos × 5 weeks × 4 types), and 6 sync logs. Run with `npm run db:seed`. It wipes the database first — safe only in development.

---

## API Pattern

### Response envelope

Every Express handler returns this shape — defined in `src/types/api.ts`:

```ts
type ApiResponse<T> =
  | { success: true;  data: T }
  | { success: false; error: string; code?: string };
```

Use `code` for machine-readable error classification (`UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, etc.). Use `error` for a human-readable message. Never expose stack traces in `5xx` responses.

### Validation pattern

All incoming data is validated with Zod before touching the database:

```ts
const parsed = someSchema.safeParse(req.body);
if (!parsed.success) {
  res.status(400).json({ success: false, error: "Invalid input", code: "VALIDATION_ERROR",
    details: parsed.error.flatten().fieldErrors });
  return;
}
const { field1, field2 } = parsed.data; // type-safe from here
```

Zod schemas live in `src/lib/validation/schemas.ts`. Add new schemas there — not inline in route files.

### Standard status codes in use

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 202 | Accepted (async work started — e.g. sync) |
| 400 | Validation error |
| 401 | No/invalid/expired session |
| 403 | Authenticated but not authorised for this resource |
| 404 | Resource not found |
| 409 | Conflict (duplicate email, repo already connected, sync already running) |
| 422 | Unprocessable (business rule violation — e.g. repo limit exceeded) |
| 429 | Rate limited |
| 500 | Unexpected server error |
| 502 | Upstream (GitHub API) error |

---

## Component Pattern

### Data fetching

Every data-fetching component uses a dedicated TanStack Query hook from `hooks/`:

```ts
// In the component:
const { data: repos = [], isLoading } = useRepos();

// Hook implementation (hooks/useRepos.ts):
const { data: repos } = useQuery({
  queryKey: ["repos"],
  queryFn: async () => {
    const result = await api.get<{ repositories: Repo[] }>("/api/repos");
    return result.repositories;
  },
});
```

`api.get/post/delete` in `lib/apiClient.ts` unwraps the `ApiResponse` envelope and throws an `ApiError` on `success: false`, which TanStack Query captures as the query's `error` state.

### Three render paths

Every component that fetches data renders three states:

```tsx
if (isLoading) return <Spinner size="lg" />;
if (error)     return <p className="text-red-600">{error.message}</p>;
return <ActualContent />;
```

### Conditional classes

Use `cn()` (from `lib/cn.ts`) for conditional Tailwind classes — never string concatenation:

```ts
import { cn } from "@/lib/cn";
<div className={cn("base-class", isActive && "active-class", className)} />
```

### Client vs server components

All components under `app/` and `components/` that use React hooks (`useState`, `useEffect`, TanStack Query hooks) must have `"use client"` as their first line. Components that do not use hooks and do not import `lib/apiClient.ts` can remain server components.

---

## Testing Pattern

### Framework and tools

| Tool | Purpose |
|---|---|
| Vitest | Test runner (configured in `vitest.config.ts`) |
| supertest | HTTP testing against the Express `app` object |
| Prisma + real PostgreSQL | Integration tests use `TEST_DATABASE_URL` — no mocking |

Tests run serially (`poolOptions: { forks: { singleFork: true } }`) because they share a real database.

### Test helpers (`__tests__/helpers.ts`)

```ts
resetDb()         // deletes all rows in FK-safe order — call in beforeEach
teardown()        // disconnects Prisma — call in afterAll
createAuthUser(email, password)  // creates a User + Session row, returns { user, token }
```

### Integration test structure

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/db";
import { resetDb, teardown, createAuthUser } from "./helpers";

beforeEach(resetDb);
afterAll(teardown);

describe("GET /api/some-route", () => {
  it("returns 200 with valid auth", async () => {
    const { token } = await createAuthUser("user@example.com");
    const res = await request(app)
      .get("/api/some-route")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/some-route");
    expect(res.status).toBe(401);
  });
});
```

### Coverage targets

Configured in `vitest.config.ts`: 80% statements/functions/lines, 75% branches, covering `src/**/*.ts` (excluding `src/server.ts` and `src/types/`).

---

## What To Never Do

**Never use fallback values for secrets.** `JWT_SECRET` and `ENCRYPTION_KEY` must be set — the application throws at startup if either is missing. There is no silent fallback. Any code that adds `?? "some-default"` to a secret read creates a critical vulnerability.

**Never commit `.env`.** It is in `.gitignore`. If it ever gets tracked (`git ls-files .env` returns output), remove it with `git rm --cached .env` immediately and rotate all secrets.

**Never hand-edit migration files.** The `prisma/migrations/` directory is generated by Prisma. Editing SQL directly breaks the migration checksum and will cause `migrate deploy` to fail in CI and production.

**Never instantiate `new PrismaClient()` outside `src/lib/db.ts`.** Multiple instances exhaust the PostgreSQL connection pool. Always import from `../lib/db`.

**Never mock the database in integration tests.** Tests in `__tests__/` connect to a real `TEST_DATABASE_URL`. Mocking Prisma hides schema mismatches and migration regressions. Unit tests (in `src/**/*.test.ts`) may stub external HTTP calls but not the DB.

**Never store GitHub tokens in plain text.** The token must pass through `encryptToken()` before reaching Prisma. The key is derived per-repo via HKDF, so each repository's token uses a different AES-256-GCM key.

**Never return `password_hash` in API responses.** The `authenticate` middleware sets `req.userId`; fetch the user and manually select fields. The test suite explicitly asserts `expect(res.body.data).not.toHaveProperty("password_hash")` on every auth endpoint.

**Never import server-only code (Prisma, `src/lib/*`) into client components.** The `src/` directory is Express-only. Client components call the API via `lib/apiClient.ts`. The boundary is enforced by the two-server architecture — there is no shared import path.

**Never add `app/api/` Next.js route handlers that duplicate Express routes.** All `/api/*` traffic is rewritten by `next.config.ts` to the Express server on port 4000. Adding Next.js API routes at `app/api/` would create silent routing conflicts depending on whether the rewrite fires first.
