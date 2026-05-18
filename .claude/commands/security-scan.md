Run a full security audit of this codebase. Complete every step. Assign a severity (Critical / High / Medium / Low) to each finding and track the total count per severity. Print a consolidated summary at the end.

---

## Step 1 — Dependency vulnerability audit

Run `npm audit --json`. Parse the JSON output.

For each vulnerability with severity `critical` or `high`:
- Record: package name, severity, vulnerability title, and whether a fix is available.

Summarise: "X critical, Y high vulnerabilities found in dependencies."
If zero: record ✅ No high/critical dependency vulnerabilities.

---

## Step 2 — Dangerous code patterns

Use Glob to find all `.ts` and `.tsx` files under `src/`, `app/`, `components/`, `hooks/`, and `lib/` (exclude `node_modules`, `.next`, `coverage`).

Grep those files for each pattern below. For every match, record file path, line number, the matched line, and assign the listed severity:

| Pattern | Severity |
|---|---|
| `eval(` | Critical |
| `dangerouslySetInnerHTML` | High |
| `innerHTML\s*=` | High |
| `exec(` | High |
| `child_process` | High |
| `document\.write(` | Medium |
| `\.html(` | Medium |

If a pattern has no matches: note ✅ No matches for `<pattern>`.

---

## Step 3 — API route authentication coverage

Glob all route files matching `src/routes/*.ts`.

Read each file. For every route handler (`router.get`, `router.post`, `router.put`, `router.patch`, `router.delete`):
- Check whether the `authenticate` middleware (or any equivalent auth middleware) appears in that route's handler chain.
- If it is missing: record ❌ **High** — Unauthenticated route: `<METHOD> <path>` in `<file>`.
- If present: record ✅ Auth present.

Exception: `/api/auth/register` and `/api/auth/login` are intentionally public — do not flag these.

---

## Step 4 — Hardcoded secrets scan

Grep all `.ts`, `.tsx`, `.js`, and `.env*` files (excluding `node_modules`, `.next`, `coverage`, `package-lock.json`, `*.example`) for these patterns (case-insensitive):

| Pattern | Severity |
|---|---|
| `password\s*=\s*["'\`][^"'\`]{4,}` | Critical |
| `secret\s*=\s*["'\`][^"'\`]{4,}` | Critical |
| `api_key\s*=\s*["'\`][^"'\`]{4,}` | Critical |
| `token\s*=\s*["'\`][^"'\`]{8,}` | High |
| `ghp_[A-Za-z0-9]{36}` | Critical |
| `sk-[A-Za-z0-9]{32,}` | Critical |

For each match: record file, line number, and a redacted line (replace the literal value with `[REDACTED]`).
If no matches: record ✅ No hardcoded secrets found.

---

## Step 5 — .env in .gitignore

Read `.gitignore` from the project root.

- If `.env` (or `.env*`) appears as an entry: record ✅ `.env` is excluded from version control.
- If it does not appear: record ❌ **Critical** — `.env` is not listed in `.gitignore`. Any committed `.env` file exposes secrets to the repository.

Check whether a `.env` file currently exists and is tracked by git: run `git ls-files .env`. If it returns output: record ❌ **Critical** — `.env` is tracked by git and must be removed with `git rm --cached .env`.

---

## Step 6 — Input validation before database access

Read each file in `src/routes/*.ts`.

For each route handler that performs a database write (`prisma.*.create`, `prisma.*.update`, `prisma.*.upsert`, `prisma.*.delete`):
- Check whether a Zod `.safeParse` or `.parse` call on `req.body` or `req.query` appears **before** the database call in the same handler.
- If validation is present: record ✅ Input validated in `<file>` `<route>`.
- If validation is absent: record ❌ **High** — No input validation before DB write in `<file>` `<route>`.

---

## Step 7 — Final summary

Print this block:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SECURITY SCAN RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Critical : <count>
  High     : <count>
  Medium   : <count>
  Low      : <count>
  Total    : <count>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If total is 0: print `✅ No security issues found.`
If total > 0: print `❌ <total> issue(s) found — address Critical and High findings before merging or deploying.`

List all findings grouped by severity (Critical first), each with: severity badge, file, line, and description.
