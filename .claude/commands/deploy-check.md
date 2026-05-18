Run a pre-deployment verification checklist for this project. Work through every step in order. Do not skip a step even if an earlier step fails — complete all checks and report everything at the end.

---

## Step 1 — Run tests

Run `npm test`. Capture the exit code and output.
- If exit code is 0: record ✅ Tests passed.
- If exit code is non-zero: record ❌ Tests failed. Include the failing test names and error messages in the report.

---

## Step 2 — Run production build

Run `npm run build`. Capture the exit code and output.
- If exit code is 0: record ✅ Build succeeded.
- If exit code is non-zero: record ❌ Build failed. Include the error output in the report.

---

## Step 3 — Check for uncommitted changes

Run `git status --short`.
- If the output is empty: record ✅ Working tree clean.
- If there are any modified, added, or deleted files: record ❌ Uncommitted changes present. List every file shown in the output.

---

## Step 4 — Check the current branch

Run `git branch --show-current`. Read the output.
- If the branch is `main` or `master`: record ✅ Deploying from main branch.
- If it is any other branch: record ⚠️ WARNING: deploying from branch `<branch name>` — confirm this is intentional before proceeding.

---

## Step 5 — Check for debug artifacts in source files

Use Glob to find all `.ts` and `.tsx` source files under `src/`, `app/`, `components/`, `hooks/`, and `lib/` (exclude `node_modules`, `.next`, and `coverage`).

For each of these patterns, Grep the discovered files:
- `console\.log(`
- `debugger`
- `TODO`

For each match found, record the file path, line number, and matched line. If no matches exist for a pattern, record ✅ No `<pattern>` found.

---

## Step 6 — Check environment variable documentation

Run `grep -rh "process\.env\." src/ app/ lib/ components/ hooks/ --include="*.ts" --include="*.tsx" 2>/dev/null` to collect every `process.env.VAR_NAME` reference in the source.

Extract the distinct variable names (e.g. `JWT_SECRET`, `DATABASE_URL`).

Check whether `.env.example` exists in the project root.
- If `.env.example` does not exist: record ❌ `.env.example` is missing — create it and document all required variables.
- If it exists: Read `.env.example`. For each variable name found in source, check whether it appears in `.env.example`. Report any variables that are used in code but absent from `.env.example` as ❌ Undocumented env var: `VAR_NAME`.

---

## Step 7 — Scan for hardcoded secrets

Grep all `.ts`, `.tsx`, `.js`, and `.json` files (excluding `node_modules`, `.next`, `coverage`, `package-lock.json`) for these patterns (case-insensitive):
- `password\s*=\s*["'\`][^"'\`]{4,}`
- `secret\s*=\s*["'\`][^"'\`]{4,}`
- `api_key\s*=\s*["'\`][^"'\`]{4,}`
- `token\s*=\s*["'\`][^"'\`]{8,}`
- `ghp_[A-Za-z0-9]{36}`
- `sk-[A-Za-z0-9]{32,}`

For each match: record the file, line number, and a redacted version of the matched line (replace the value with `[REDACTED]`). If no matches: record ✅ No hardcoded secrets found.

---

## Step 8 — Final summary

Print a single block at the end:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEPLOY-CHECK RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Tests            : ✅/❌
  Build            : ✅/❌
  Clean working tree: ✅/❌
  Branch           : ✅/⚠️ <branch>
  Debug artifacts  : ✅/❌ (<count> found)
  Env vars docs    : ✅/❌ (<count> undocumented)
  Hardcoded secrets: ✅/❌ (<count> found)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If every item is ✅ (and any branch warning was acknowledged): print `✅ Ready to deploy`.
If any item is ❌: print `❌ Not ready — fix issues above before deploying`.
