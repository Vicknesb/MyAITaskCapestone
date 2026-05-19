**Context:** DevPulse stores bcrypt password hashes, AES-256-GCM encrypted GitHub tokens, and JWT session tokens in PostgreSQL. The Express API handles authentication, token encryption/decryption, and proxied GitHub API calls. The Next.js layer sets security headers via edge middleware. Security regressions in this codebase can expose user credentials or allow unauthorized repository access.

**Role:** You are a security engineer auditing this codebase for vulnerabilities before a release. You are thorough, assign accurate severity ratings, and distinguish between theoretical risks and exploitable issues.

**Intent:** Perform a full security audit covering dependency vulnerabilities, dangerous code patterns, authentication coverage, hardcoded secrets, input validation, and `.env` hygiene. Produce a prioritised findings list and a final severity-bucketed summary.

**Structure:** Complete all 6 audit steps in order. Assign a severity (Critical / High / Medium / Low) to every finding. At the end, print the consolidated summary block with total counts per severity and a list of all findings sorted Critical-first.

**Parameters:**
- Severity definitions: Critical = exploitable without auth; High = exploitable with auth or leads to data exposure; Medium = defence-in-depth gap; Low = best-practice deviation
- Auth exception: `POST /api/auth/register` and `POST /api/auth/login` are intentionally public — do not flag as unauthenticated
- Exclude from scans: `node_modules/`, `.next/`, `coverage/`, `package-lock.json`, `*.example`

---

## Step 1 — Dependency vulnerability audit

Run `npm audit --json`. Parse the output.

For each vulnerability with severity `critical` or `high`:
- Record: package name, severity, vulnerability title, fix availability

Summary line: "X critical, Y high vulnerabilities in dependencies."
Zero findings → ✅ No high/critical dependency vulnerabilities

---

## Step 2 — Dangerous code patterns

Glob all `.ts` and `.tsx` files under `src/`, `app/`, `components/`, `hooks/`, `lib/`.

Grep for each pattern below. For every match record file, line number, matched line, and assigned severity:

| Pattern | Severity |
|---|---|
| `eval(` | Critical |
| `dangerouslySetInnerHTML` | High |
| `innerHTML\s*=` | High |
| `exec(` | High |
| `child_process` | High |
| `document\.write(` | Medium |
| `\.html(` | Medium |

No matches for a pattern → ✅ No `<pattern>` found

---

## Step 3 — API route authentication coverage

Glob `src/routes/*.ts`. Read each file.

For every route handler (`router.get`, `router.post`, `router.put`, `router.patch`, `router.delete`):
- Present → ✅ Auth present on `<METHOD> <path>`
- Missing → ❌ **High** — Unauthenticated route: `<METHOD> <path>` in `<file>`

Apply the auth exception from **Parameters** for register and login.

---

## Step 4 — Hardcoded secrets scan

Grep all `.ts`, `.tsx`, `.js`, and `.env*` files (apply exclusions from **Parameters**) for:

| Pattern | Severity |
|---|---|
| `ghp_[A-Za-z0-9]{36}` | Critical |
| `password\s*=\s*["'\`][^"'\`]{4,}` | Critical |
| `secret\s*=\s*["'\`][^"'\`]{4,}` | Critical |
| `api_key\s*=\s*["'\`][^"'\`]{4,}` | Critical |
| `token\s*=\s*["'\`][^"'\`]{8,}` | High |
| `sk-[A-Za-z0-9]{32,}` | Critical |

For each match: record file, line, and redact the value as `[REDACTED]`.
Zero findings → ✅ No hardcoded secrets found

---

## Step 5 — `.env` in `.gitignore` and git tracking

Read `.gitignore`.
- `.env` or `.env*` listed → ✅ `.env` excluded from version control
- Not listed → ❌ **Critical** — `.env` not in `.gitignore`

Run `git ls-files .env`.
- No output → ✅ `.env` not tracked by git
- Output returned → ❌ **Critical** — `.env` is tracked; run `git rm --cached .env` and rotate all secrets immediately

---

## Step 6 — Input validation before database writes

Read each file in `src/routes/*.ts`.

For every handler that calls `prisma.*.create`, `prisma.*.update`, `prisma.*.upsert`, or `prisma.*.delete`:
- Zod `.safeParse` or `.parse` appears before the DB call → ✅ Validated in `<file>` `<route>`
- No validation found → ❌ **High** — No input validation before DB write in `<file>` `<route>`

---

## Step 7 — Final summary

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

Total = 0 → `✅ No security issues found.`
Total > 0 → `❌ <total> issue(s) found — address Critical and High findings before merging or deploying.`

List all findings grouped by severity (Critical first), each with: severity badge, file:line, and description.
