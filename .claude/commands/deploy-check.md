**Context:** DevPulse is a dual-server application (Next.js + Express) deployed from the `master` branch. CI runs tests, a production build, and `npm audit` on every push. A deploy is only safe when all CI gates pass, the working tree is clean, no debug artifacts are present, and all required environment variables are documented.

**Role:** You are a DevOps engineer performing a pre-deployment gate check. You are methodical and do not skip steps — a missed check that reaches production is worse than a false alarm.

**Intent:** Verify that the current state of the repository is safe to deploy. Run every check below in order, record pass/fail for each, and produce a single go/no-go verdict at the end.

**Structure:** Work through all 7 steps sequentially. Do not stop early if a step fails — complete every check so the full picture is visible. Print the consolidated summary block at the end.

**Parameters:**
- Target branch for deploy: `master`
- Required env vars to verify in `.env.example`: `DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`
- Debug patterns to scan: `console.log(`, `debugger`, `TODO`
- Secret patterns to scan: `ghp_[A-Za-z0-9]{36}`, `secret\s*=\s*["'\`]`, `api_key\s*=\s*["'\`]`

---

## Step 1 — Run tests

Run `npm test`. Capture the exit code and output.
- Exit code 0 → ✅ Tests passed
- Non-zero → ❌ Tests failed — include failing test names and error messages in the report

---

## Step 2 — Run production build

Run `npm run build`. Capture the exit code.
- Exit code 0 → ✅ Build succeeded
- Non-zero → ❌ Build failed — include the error output

---

## Step 3 — Check for uncommitted changes

Run `git status --short`.
- Empty output → ✅ Working tree clean
- Any output → ❌ Uncommitted changes — list every file shown

---

## Step 4 — Check the current branch

Run `git branch --show-current`.
- `main` or `master` → ✅ Deploying from main branch
- Any other branch → ⚠️ WARNING: deploying from `<branch>` — confirm this is intentional

---

## Step 5 — Scan for debug artifacts

Glob all `.ts` and `.tsx` files under `src/`, `app/`, `components/`, `hooks/`, `lib/` (exclude `node_modules`, `.next`, `coverage`).

Grep for each pattern. For every match record file path, line number, and matched line:
- `console\.log(` → ⚠️ Debug log left in source
- `debugger` → ❌ Debugger statement left in source
- `TODO` → ⚠️ Unresolved TODO comment

No matches → ✅ No debug artifacts found

---

## Step 6 — Verify environment variable documentation

Collect every `process.env.VAR_NAME` reference from `src/`, `app/`, `lib/`, `components/`, `hooks/`.

Check `.env.example` exists and contains each variable found in source.
- All documented → ✅ Env vars documented
- Missing entries → ❌ Undocumented env var: `VAR_NAME` — add it to `.env.example`

Also scan for hardcoded secrets using the patterns in **Parameters**. Any match → ❌ Critical — hardcoded secret in `<file>:<line>` [REDACTED].

---

## Step 7 — Final summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEPLOY-CHECK RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Tests             : ✅/❌
  Build             : ✅/❌
  Clean working tree: ✅/❌
  Branch            : ✅/⚠️ <branch>
  Debug artifacts   : ✅/❌ (<count> found)
  Env vars docs     : ✅/❌ (<count> undocumented)
  Hardcoded secrets : ✅/❌ (<count> found)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

All ✅ → `✅ Ready to deploy`
Any ❌ → `❌ Not ready — fix issues above before deploying`
