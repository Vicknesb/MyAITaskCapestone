# DevPulse Security Audit

**Date:** 2026-05-19 (initial) / updated 2026-05-19 (Sprint 2 fixes)  
**Auditor:** Claude Sonnet 4.6 (automated review)  
**Scope:** All API routes, auth layer, crypto utilities, middleware, CI/CD pipeline, and client pages  
**Branch:** `master`

---

## Summary

| Severity | Total found | Fixed | Open |
|---|---|---|---|
| CRITICAL | 2 | 2 | 0 |
| HIGH | 2 | 2 | 0 |
| MEDIUM | 5 | 5 | 0 |
| LOW | 2 | 2 | 0 |
| **Total** | **11** | **11** | **0** |

All 11 findings are resolved. Nine were fixed in Sprint 1; two LOW-severity items (F-10, F-11) were closed in Sprint 2.

---

## Findings

### F-01 — Hardcoded fallback JWT secret

| Field | Value |
|---|---|
| **Severity** | CRITICAL |
| **File** | `src/lib/auth/jwt.ts` |
| **Line** | 5 |
| **Status** | **Fixed (Sprint 1)** |

**Finding:** The JWT signing key fell back to the literal string `"dev-secret-not-for-production"` when `JWT_SECRET` was not set. Any attacker who knows this string can forge valid session tokens for any user.

```ts
// BEFORE — vulnerable
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-not-for-production";
```

**Fix applied:** The fallback was removed. The module now throws at load time if `JWT_SECRET` is absent:

```ts
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required but not set");
}
```

A top-level `validateEnv()` call in `src/server.ts` also validates all three required variables (`DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`) before any modules are imported.

---

### F-02 — Hardcoded fallback AES-256-GCM encryption key

| Field | Value |
|---|---|
| **Severity** | CRITICAL |
| **File** | `src/lib/crypto/tokenEncryption.ts` |
| **Lines** | 4–6 |
| **Status** | **Fixed (Sprint 1)** |

**Finding:** When `ENCRYPTION_KEY` was not set, all GitHub PATs were encrypted with a static all-zeros base64 key. Anyone with this value could decrypt every stored GitHub token.

```ts
// BEFORE — vulnerable
const master = Buffer.from(
  process.env.ENCRYPTION_KEY ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  "base64"
).slice(0, 32);
```

**Fix applied:** The fallback was removed. The function throws if `ENCRYPTION_KEY` is absent, validates that the decoded key is at least 32 bytes, and now uses a non-empty HKDF salt (see F-10).

---

### F-03 — No rate limiting on authentication endpoints

| Field | Value |
|---|---|
| **Severity** | HIGH |
| **File** | `src/routes/auth.ts` |
| **Line** | 15, 66 (route handlers) |
| **Status** | **Fixed (Sprint 1)** |

**Finding:** `POST /api/auth/login` and `POST /api/auth/register` had no request-rate controls, allowing unlimited brute-force attacks and registration flooding.

**Fix applied:** `express-rate-limit` added. Login: 10 requests per 15 minutes per IP. Register: 5 requests per hour per IP. Both return `429` with `Retry-After` header.

---

### F-04 — Unvalidated `path` parameter enables URL injection in file browser

| Field | Value |
|---|---|
| **Severity** | HIGH |
| **File** | `src/routes/repos.ts` |
| **Lines** | 160–164 |
| **Status** | **Fixed (Sprint 1)** |

**Finding:** The `path` query parameter was interpolated directly into the GitHub Contents API URL, allowing path traversal (`../../other-repo`) and query-string injection.

**Fix applied:** Parameter is now validated against `^[\w\-./]+$`, path-traversal sequences (`..`) are explicitly blocked, and the path is URI-encoded before being placed in the URL.

---

### F-05 — Renewed JWT exposed in `X-Renewed-Token` response header

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **File** | `src/middleware/authenticate.ts` |
| **Line** | 57 |
| **Status** | **Fixed (Sprint 1)** |

**Finding:** When a session was close to expiry, the authenticate middleware issued a new token and echoed it in a custom `X-Renewed-Token` response header. HTTP headers are routinely recorded in proxy logs, exposing valid JWTs in plain text.

**Fix applied:** The `X-Renewed-Token` header was removed. Refreshed tokens are delivered only via `Set-Cookie` (httpOnly).

---

### F-06 — `unsafe-eval` in Content-Security-Policy applies to production

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **File** | `middleware.ts` |
| **Line** | 21 |
| **Status** | **Fixed (Sprint 1)** |

**Finding:** The CSP `script-src` directive included `'unsafe-eval'` on all requests, including production. `unsafe-eval` permits `eval()` and similar constructs — a significant XSS amplifier.

**Fix applied:** `'unsafe-eval'` is now conditional on `NODE_ENV !== "production"`:

```ts
`script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`
```

Production CSP no longer includes `unsafe-eval`.

---

### F-07 — Session token duplicated in JSON response body

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **File** | `src/routes/auth.ts` |
| **Lines** | 58–61 (register), 110–113 (login) |
| **Status** | **Fixed (Sprint 1)** |

**Finding:** Both login and register responses included `data.token` in the JSON body alongside the httpOnly cookie. A client storing this token in `localStorage` or React state eliminates the XSS protection that httpOnly provides.

**Fix applied:** `token` was removed from both response bodies. The cookie is sufficient for browser clients. The API response now returns only `{ user: { id, email, name }, expires_at }`.

---

### F-08 — No security headers on Express API server

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **File** | `src/app.ts` |
| **Line** | 14 |
| **Status** | **Fixed (Sprint 1)** |

**Finding:** The Express API at port 4000 had no security headers. If the API port is exposed directly (misconfigured proxy, development, Docker), responses carry no `X-Content-Type-Options`, `X-Frame-Options`, or other protections.

**Fix applied:** `helmet` was added as the first middleware:

```ts
import helmet from "helmet";
app.use(helmet()); // X-Content-Type-Options, X-Frame-Options, HSTS, etc.
```

---

### F-09 — Unbounded date range in metrics/dashboard queries

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **File** | `src/lib/validation/schemas.ts` |
| **Lines** | 19–32 |
| **Status** | **Fixed (Sprint 1)** |

**Finding:** The `from`/`to` query parameters accepted any date string with no validation that `from < to` or any cap on the window. A request spanning decades would trigger a full-table scan on the `metrics` table, enabling resource-exhaustion DoS.

**Fix applied:** Zod refinements added: `from` must be ≤ `to`, and the range must not exceed 90 days. Both checks return `400 VALIDATION_ERROR`.

```ts
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
.refine((d) => d.from <= d.to, { message: "from must be before to" })
.refine((d) => d.to.getTime() - d.from.getTime() <= MAX_RANGE_MS,
  { message: "Date range cannot exceed 90 days" })
```

---

### F-10 — HKDF derivation uses empty salt

| Field | Value |
|---|---|
| **Severity** | LOW |
| **File** | `src/lib/crypto/tokenEncryption.ts` |
| **Line** | 8 |
| **Status** | **Fixed (Sprint 2)** |

**Finding:** The per-repo key derivation used `Buffer.alloc(0)` as the HKDF salt. RFC 5869 §3.1 states that an empty salt defaults to a zero-filled HMAC key, reducing domain separation and weakening the derivation margin against master-key compromise.

**Fix applied:** A fixed, non-secret, application-specific salt is now used:

```ts
const HKDF_SALT = Buffer.from("devpulse-v1-github-token-encryption");
// ...
hkdfSync("sha256", master, HKDF_SALT, `devpulse-github-token-${repoId}`, 32)
```

**Migration note:** This change alters all derived keys. Any existing deployment must re-encrypt all stored GitHub tokens before upgrading. The info parameter was also made more specific (`devpulse-github-token-${repoId}` instead of `String(repoId)`) for additional domain separation.

---

### F-11 — Sync error messages stored verbatim in database

| Field | Value |
|---|---|
| **Severity** | LOW |
| **File** | `src/lib/github/syncEngine.ts` |
| **Line** | 121 |
| **Status** | **Fixed (Sprint 2)** |

**Finding:** Uncaught errors during sync were stored as `error_message: err instanceof Error ? err.message : String(err)`. Node.js error messages can contain file-system paths, environment variable names, or internal identifiers. If `SyncLog.error_message` is ever surfaced to an end user, internal structure is leaked.

**Fix applied:** A `sanitizeSyncError()` function maps raw errors to safe, user-visible messages before DB persistence:

```ts
function sanitizeSyncError(err: unknown): string {
  if (!(err instanceof Error)) return "Unexpected sync failure";
  const msg = err.message;
  if (/GitHub API (401|403)/.test(msg))  return "GitHub authentication failed — token may be invalid or revoked";
  if (/GitHub API 404/.test(msg))        return "Repository not found on GitHub";
  if (/GitHub API 429/.test(msg))        return "GitHub rate limit exceeded — sync will retry";
  if (/GitHub API 5\d\d/.test(msg))      return "GitHub API server error — sync will retry";
  if (msg.startsWith("GitHub API"))      return "GitHub API error";
  return "Sync failed — check repository connection and token validity";
}
```

Raw error details are no longer written to `SyncLog.error_message`. All 5 message branches are tested in `syncEngine.test.ts`.

---

## Additional Hardening Applied (Not in Original Audit Scope)

### H-01 — Invalid ENCRYPTION_KEY in CI workflow

**Severity:** HIGH (would cause all integration tests to fail in CI)  
**File:** `.github/workflows/ci.yml`  
**Status:** Fixed

The CI `ENCRYPTION_KEY` value `"ci-test-encryption-key-32-bytes!!"` contained `-` and `!` characters that Node.js's base64 decoder silently ignores, reducing the decoded length to ~19 bytes — below the 32-byte minimum enforced by `derivedKey()`. All integration tests calling `encryptToken()` would throw in CI.

**Fix:** Replaced with `Y2ktdGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcyE=`, which is valid base64 decoding to exactly 32 bytes (`"ci-test-encryption-key-32-bytes!"`).

### H-02 — No startup environment validation

**Severity:** MEDIUM  
**File:** `src/server.ts`  
**Status:** Fixed

The server had no startup check for `DATABASE_URL`. A misconfigured deployment would start, serve requests, and fail only on the first database call with a cryptic Prisma error.

**Fix:** `validateEnv()` in `src/lib/env.ts` checks all three required variables at startup and throws a descriptive error listing every missing variable before any modules are imported.

### H-03 — No deploy stage in CI pipeline

**Severity:** LOW  
**File:** `.github/workflows/ci.yml`  
**Status:** Fixed

The CI pipeline had no deployment job, making it impossible to verify that deployments use production secrets.

**Fix:** A `deploy` job was added that gates on `test + build + security` passing, runs only on `push` to `master`, uses `environment: production` for secret isolation, injects `${{ secrets.* }}` for all credentials, and runs `prisma migrate deploy` before the production build.

---

## Fixes by Sprint

### Sprint 1 (initial audit)
- F-01, F-02: Remove hardcoded secret fallbacks
- F-03: Rate limiting on auth endpoints  
- F-04, F-05: Sanitize file-browser path; remove token from renewal header
- F-06: Restrict `unsafe-eval` to non-production CSP
- F-07: Remove token from login/register response body
- F-08: Add `helmet` to Express server
- F-09: Date range validation (90-day cap, `from < to`)

### Sprint 2 (this update)
- F-10: Non-empty HKDF salt for key derivation
- F-11: Sanitize sync error messages before database persistence
- H-01: Fix invalid `ENCRYPTION_KEY` in CI workflow
- H-02: Add startup environment variable validation
- H-03: Add deploy job to CI pipeline
