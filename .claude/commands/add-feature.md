Scaffold a new feature for this project by reading the existing patterns first, then generating files that match them exactly. The feature name is: $ARGUMENTS

If $ARGUMENTS is empty, ask the user: "What is the feature name? (e.g. comments, notifications, webhooks)" and wait for their answer before continuing.

Derive two forms from the feature name:
- `featureName`: lowercase, hyphen-separated (e.g. `user-profile`)
- `FeatureName`: PascalCase (e.g. `UserProfile`)

---

## Step 1 — Read existing route patterns

Glob `src/routes/*.ts`. Pick the most recently modified file that is not `auth.ts`.

Read that file in full. Note:
- Import order and style
- How the Router is exported
- How `authenticate` middleware is applied
- How request bodies are validated (Zod schema location and usage)
- How Prisma queries are structured
- How the `ApiResponse<T>` envelope is used in responses
- Error handling style (try/catch vs inline)

Keep these patterns in mind for Step 4.

---

## Step 2 — Read existing component patterns

Glob `components/**/*.tsx`. Pick one file from a subdirectory that is not `ui/` (prefer `components/repos/` or `components/feed/`).

Read that file in full. Note:
- Whether it is a client component (`"use client"`) or server component
- Import order: React hooks, UI primitives, types
- How loading states are shown (Spinner, skeleton, etc.)
- How error states are shown
- How data is fetched (React Query hook, direct fetch, etc.)
- Tailwind class conventions (conditional classes via `cn()`, responsive breakpoints)
- TypeScript prop type definition style (`type Props = ...`)

Keep these patterns in mind for Step 5.

---

## Step 3 — Read existing test patterns

Glob `__tests__/*.test.ts`. Pick the file whose name most closely matches a route feature (e.g. `repos.test.ts`, `metrics.test.ts`).

Read that file in full. Note:
- Test framework and assertion style (Vitest, describe/it/expect)
- How the Express app is imported and how `supertest` is wired
- How the test database is seeded and cleaned up
- How authentication tokens are set in test requests
- Structure of happy-path vs edge-case tests
- Any shared helper imports from `__tests__/helpers.ts`

Keep these patterns in mind for Step 6.

---

## Step 4 — Create the API route

Create `app/api/$ARGUMENTS/route.ts`.

The file must:
- Use Next.js 15 App Router conventions: export named `GET` and `POST` async functions typed as `(req: Request) => Promise<Response>`
- Mirror the `ApiResponse<T>` envelope from `src/types/api.ts` for all responses
- Implement `GET`: authenticate via session cookie (read `devpulse_session` from `req.cookies`), return a stub list response `{ success: true, data: { items: [] } }`
- Implement `POST`: authenticate via session cookie, parse the request body with Zod (define an inline schema matching the feature's expected input), return `{ success: true, data: { id: "stub" } }` with status 201
- Return `{ success: false, error: "Unauthorized", code: "UNAUTHORIZED" }` with status 401 when no session is present
- Match the import style and error-handling patterns observed in Step 1

---

## Step 5 — Create the component

Create `components/$FeatureName.tsx`.

The file must:
- Match the client/server component style observed in Step 2 (use `"use client"` if the observed pattern does so)
- Define a `type Props` matching the feature (at minimum: `{ className?: string }`)
- Import and use the `Spinner` component from `components/ui/Spinner` for loading state
- Import and use the `Card` component from `components/ui/Card` for the container
- Show three distinct render paths:
  1. Loading state — show `<Spinner />`
  2. Error state — show the error message in a `<p className="text-red-600">` inside the Card
  3. Data state — show `<p className="text-gray-500">No $ARGUMENTS yet.</p>` inside the Card as a placeholder
- Use `cn()` from `lib/cn` for any conditional classes
- Match the Tailwind conventions observed in Step 2

---

## Step 6 — Create the test file

Create `__tests__/$ARGUMENTS.test.ts`.

The file must:
- Match the test framework and import style observed in Step 3
- Import the Express `app` from `src/app` and `supertest`
- Import the `prisma` client from `src/lib/db`
- Include a `beforeEach` / `afterEach` that cleans up any test data created by these tests
- Implement at least two tests:
  1. **Happy path**: `GET /api/$ARGUMENTS` with a valid authenticated session returns 200 and `{ success: true, data: { items: [] } }`
  2. **Edge case**: `GET /api/$ARGUMENTS` with no session cookie returns 401 and `{ success: false, error: "Unauthorized" }`
- Match the authentication setup pattern observed in Step 3 (how test tokens are generated and attached)

---

## Step 7 — Print creation summary

Print this block:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FEATURE SCAFFOLDED: <featureName>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app/api/<featureName>/route.ts
    → GET  handler with session auth + stub list response
    → POST handler with session auth + Zod body validation

  components/<FeatureName>.tsx
    → Client component with loading / error / data states
    → Uses Card, Spinner, cn() matching existing conventions

  __tests__/<featureName>.test.ts
    → Happy path: authenticated GET returns 200
    → Edge case:  unauthenticated GET returns 401
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next steps:
  1. Replace stub responses in route.ts with real Prisma queries
  2. Add a Zod schema to src/lib/validation/schemas.ts for this feature
  3. Wire the component into the relevant dashboard page
```
