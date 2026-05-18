# DevPulse — Developer Analytics Dashboard

## Project Description

DevPulse is an internal developer analytics dashboard that connects to GitHub repositories and surfaces commit frequency, pull request statistics, and team activity over time. It is designed as an engineering-team tool: self-hosted, authenticated, and focused on actionable metrics rather than vanity numbers.

The primary user is an engineering lead or team member who wants a quick view of repository health and contributor activity without switching to GitHub's native interface.

---

## Architecture Overview

```
devpulse/
├── app/                        # Next.js 15 App Router
│   ├── (auth)/                 # Route group: login, register
│   ├── (dashboard)/            # Route group: protected pages
│   │   ├── dashboard/          # Aggregated team metrics
│   │   ├── repos/              # Repository list + detail
│   │   └── settings/           # User preferences
│   ├── api/                    # Next.js API routes
│   │   ├── auth/               # register, login, session
│   │   ├── repos/              # list, connect
│   │   └── metrics/[repoId]/   # commit + PR stats
│   └── layout.tsx
├── components/                 # Shared UI components
│   ├── charts/                 # Recharts wrappers (commit freq, PR stats)
│   ├── feed/                   # Activity feed (commits, PRs)
│   └── ui/                     # Primitives (Button, Card, Input, etc.)
├── lib/                        # Pure utilities, no side effects
│   ├── github/                 # GitHub API client + MCP integration
│   ├── db/                     # Prisma client singleton
│   └── auth/                   # Session helpers, JWT utils
├── prisma/
│   ├── schema.prisma           # Source of truth for DB schema
│   └── migrations/             # Never hand-edit these
├── types/                      # Shared TypeScript types (no `any`)
└── __tests__/                  # Co-located or mirrored test files
```

### Data Flow

1. User authenticates → session stored in DB (`Session` table).
2. User connects a repo → GitHub token stored encrypted; repo record created.
3. Background sync (cron or on-demand) fetches GitHub data via the GitHub MCP server and upserts into `Metric` rows.
4. Dashboard API reads `Metric` rows and returns aggregated JSON; frontend renders charts.

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
pnpm test          # unit + component
pnpm test:int      # integration (requires TEST_DATABASE_URL)
pnpm test:e2e      # Playwright E2E
```

---

## CI/CD (GitHub Actions)

Pipeline stages run in order:

1. **Test** — `pnpm test` + `pnpm test:int`
2. **Build** — `pnpm build` (Next.js production build)
3. **Security** — dependency audit (`pnpm audit --audit-level=high`)
4. **Deploy** — only on merge to `main`; target environment is configured via repo secrets

Secrets required: `DATABASE_URL`, `GITHUB_TOKEN`, `JWT_SECRET`, `ENCRYPTION_KEY`.

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
