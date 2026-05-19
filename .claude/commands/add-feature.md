**Context:** DevPulse is a dual-server developer analytics dashboard — Next.js App Router on port 3000 and an Express API on port 4000. New features always require three artefacts: an Express route (`src/routes/`), a React component (`components/`), and an integration test (`__tests__/`). All routes share the same conventions: `authenticate` middleware, Zod validation against `src/lib/validation/schemas.ts`, and the `ApiResponse<T>` envelope from `src/types/api.ts`. The database is PostgreSQL accessed through a Prisma singleton at `src/lib/db.ts`.

**Role:** You are a senior full-stack engineer on this project. You enforce existing patterns strictly — you always read the codebase before writing new files so your output is indistinguishable from the existing code in style, structure, and naming.

**Intent:** Scaffold a complete, pattern-consistent implementation for the feature: $ARGUMENTS

**Structure:** Enter plan mode first (`/plan`) to outline exactly which files will be created and which existing files to read as references. Once the plan is approved, implement in the order: route → component → test. Print a creation summary at the end.

**Parameters:**
- Feature name from `$ARGUMENTS` (ask if empty)
- Route file target: `src/routes/<featureName>.ts`
- Component file target: `components/<FeatureName>.tsx`
- Test file target: `__tests__/<featureName>.test.ts`
- Never invent patterns — derive them by reading existing files first (Steps 1–3 below)
- Do not skip the test step
- All routes must use `authenticate` middleware and Zod validation

---

## Pre-work — Enter plan mode

Before writing any file, enter plan mode and output a plan with:
1. The three files to be created (with full paths)
2. Which existing files will be read as references for each
3. The minimum DB schema changes needed (if any)
4. Any edge cases the test file must cover

Wait for approval before proceeding to Step 1.

---

## Step 1 — Read existing route patterns

Glob `src/routes/*.ts`. Pick the most recently modified file that is not `auth.ts`.

Read that file in full. Note:
- Import order and style
- How the Router is exported and mounted
- How `authenticate` middleware is applied
- How request bodies are validated (Zod schema location and usage)
- How Prisma queries are structured
- How the `ApiResponse<T>` envelope is used in responses
- Error handling style (try/catch vs inline guards)

---

## Step 2 — Read existing component patterns

Glob `components/**/*.tsx`. Pick one file from a subdirectory that is not `ui/`.

Read that file in full. Note:
- Whether it is a client component (`"use client"`) or server component
- Import order: React hooks, UI primitives, types
- How loading, error, and empty states are rendered
- How data is fetched (TanStack Query hook pattern)
- Tailwind class conventions — conditional classes via `cn()`, responsive breakpoints
- TypeScript prop type definition style (`type Props = …`)

---

## Step 3 — Read existing test patterns

Glob `__tests__/*.test.ts`. Pick the file whose name most closely matches a route feature.

Read that file in full. Note:
- Test framework and assertion style (Vitest, describe/it/expect)
- How `supertest` is wired to the Express `app`
- How the test database is seeded and cleaned up (`resetDb`, `createAuthUser`)
- How auth tokens are set on requests
- Structure of happy-path vs edge-case tests

---

## Step 4 — Create the Express route

Create `src/routes/<featureName>.ts`.

The file must:
- Mirror the import order and export style from Step 1
- Apply `authenticate` on every handler except any intentionally public endpoints
- Validate all request bodies using a Zod schema imported from `src/lib/validation/schemas.ts` (add the schema there — do not define it inline)
- Return responses using the `ApiResponse<T>` envelope: `{ success: true, data: T }` or `{ success: false, error: string, code: string }`
- Use the status codes defined in `src/types/api.ts` (200, 201, 400, 401, 403, 404, 409, 422, 500)
- Mount the router by adding it to `src/app.ts`

---

## Step 5 — Create the React component

Create `components/<FeatureName>.tsx`.

The file must:
- Start with `"use client"` (match the pattern observed in Step 2)
- Define a `type Props` at the top of the file
- Fetch data using a dedicated TanStack Query hook in `hooks/use<FeatureName>.ts`
- Render three distinct states: loading (`<Spinner />`), error (`<p className="text-red-600">`), and data
- Use `cn()` from `lib/cn` for all conditional class composition
- Import UI primitives from `components/ui/` only — no inline styles except dynamic chart colors

---

## Step 6 — Create the integration test

Create `__tests__/<featureName>.test.ts`.

The file must:
- Import `app` from `src/app`, `prisma` from `src/lib/db`, and helpers from `./__tests__/helpers`
- Call `resetDb()` in `beforeEach` and `teardown()` in `afterAll`
- Cover at minimum:
  1. Happy path — authenticated request returns 200/201 with correct data shape
  2. Unauthenticated request returns 401
  3. One input validation error returns 400 with `code: "VALIDATION_ERROR"`
  4. One authorization boundary — user A cannot access user B's resource

---

## Step 7 — Print creation summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FEATURE SCAFFOLDED: <featureName>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  src/routes/<featureName>.ts
    → All handlers authenticated via authenticate middleware
    → Zod schema added to src/lib/validation/schemas.ts
    → Mounted in src/app.ts

  components/<FeatureName>.tsx
    → Client component: loading / error / data states
    → TanStack Query hook: hooks/use<FeatureName>.ts

  __tests__/<featureName>.test.ts
    → Happy path, 401, 400 validation, authz boundary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next steps:
  1. Replace stub responses with real Prisma queries
  2. Wire the component into the relevant dashboard page
  3. Run npm test to verify the new tests pass
```
