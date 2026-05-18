# DevPulse Security Audit

**Date:** 2026-05-19  
**Auditor:** Claude Sonnet 4.6 (automated review)  
**Scope:** All API routes, auth layer, crypto utilities, middleware, and client pages  
**Branch:** `master` @ `9bd4901`

---

## Summary

| Severity | Count | Fixed in this audit |
|---|---|---|
| CRITICAL | 2 | 2 |
| HIGH | 2 | 2 |
| MEDIUM | 5 | 1 |
| LOW | 2 | 0 |
| **Total** | **11** | **5** |

Three fix sets were applied, resolving all CRITICAL and HIGH findings plus one MEDIUM.

---

## Findings

### F-01 — Hardcoded fallback JWT secret

| Field | Value |
|---|---|
| **Severity** | CRITICAL |
| **File** | `src/lib/auth/jwt.ts` |
| **Line** | 5 |
| **Status** | **Fixed** |

**Finding:** The JWT signing key falls back to the literal string `"dev-secret-not-for-production"` when `JWT_SECRET` is not set. Any attacker who knows this string can forge valid session tokens for any user.

```ts
// BEFORE — vulnerable
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-not-for-production";
```

**Fix applied:** The fallback was removed. The module now throws at load time if `JWT_SECRET` is absent, ensuring the server refuses to start with a missing secret rather than silently degrading to a known-weak key.

---

### F-02 — Hardcoded fallback AES-256-GCM encryption key

| Field | Value |
|---|---|
| **Severity** | CRITICAL |
| **File** | `src/lib/crypto/tokenEncryption.ts` |
| **Lines** | 4–6 |
| **Status** | **Fixed** |

**Finding:** When `ENCRYPTION_KEY` is not set, all GitHub PATs are encrypted with a static all-zeros base64 key (`"AAAA…="`). Anyone with this value can decrypt every stored GitHub token in the database.

```ts
// BEFORE — vulnerable
const master = Buffer.from(
  process.env.ENCRYPTION_KEY ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  "base64"
).slice(0, 32);
```

**Fix applied:** The fallback was removed. The function now throws if `ENCRYPTION_KEY` is absent, and validates that the decoded key is exactly 32 bytes before use.

---

### F-03 — No rate limiting on authentication endpoints

| Field | Value |
|---|---|
| **Severity** | HIGH |
| **File** | `src/routes/auth.ts` |
| **Line** | 15, 66 (route handlers) |
| **Status** | **Fixed** |

**Finding:** `POST /api/auth/login` and `POST /api/auth/register` have no request-rate controls. An attacker can attempt unlimited password guesses (brute force) or flood the registration endpoint to enumerate emails / exhaust database connections.

**Fix applied:** `express-rate-limit` was added. Login is limited to 10 requests per 15 minutes per IP; registration to 5 requests per hour per IP. Both return `429` with a `Retry-After` header and a standard API envelope on limit.

---

### F-04 — Unvalidated `path` parameter enables URL injection in file browser

| Field | Value |
|---|---|
| **Severity** | HIGH |
| **File** | `src/routes/repos.ts` |
| **Lines** | 160–164 |
| **Status** | **Fixed** |

**Finding:** The `path` query parameter is interpolated directly into the GitHub Contents API URL without sanitization:

```ts
// BEFORE — vulnerable
const path = typeof req.query["path"] === "string" ? req.query["path"] : "";
const apiUrl = `https://api.github.com/repos/${repository.full_name}/contents/${path}?ref=...`;
```

Values such as `../../other-owner/private-repo/secret`, `file?token=evil`, or `file#injection` could manipulate the constructed URL, potentially traversing outside the connected repository or injecting extra query parameters before the `ref` is appended. The `path` segment in a GitHub API URL is never encoded, so percent-encoded traversals also pass through.

**Fix applied:** The parameter is now validated against a strict allowlist pattern (`^[\w\-./]+$`), path-traversal sequences (`..`) are explicitly blocked, and the path is URI-encoded before being placed in the URL.

---

### F-05 — Renewed JWT exposed in `X-Renewed-Token` response header

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **File** | `src/middleware/authenticate.ts` |
| **Line** | 57 |
| **Status** | **Fixed** |

**Finding:** When a session is close to expiry, the authenticate middleware issues a new token and echoes it in a custom response header:

```ts
res.setHeader("X-Renewed-Token", newToken);
```

HTTP response headers are routinely recorded by reverse proxies, load balancers, CDNs, APM agents, and WAFs. A JWT in a header will appear in access logs in plain text, giving anyone with log access a valid session token for the user who happened to trigger that renewal.

**Fix applied:** The `X-Renewed-Token` header was removed. Clients relying on the httpOnly cookie receive the refreshed token automatically via `Set-Cookie`; Bearer-based clients should re-authenticate when they receive a `401`.

---

### F-06 — `unsafe-eval` in Content-Security-Policy applies to production

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **File** | `middleware.ts` |
| **Line** | 22 |
| **Status** | Open |

**Finding:** The CSP `script-src` directive includes `'unsafe-eval'` with a comment attributing it to Next.js dev requirements. The same CSP is returned on all requests, including production. `unsafe-eval` permits `eval()`, `new Function()`, `setTimeout(string)`, and similar constructs — a significant XSS amplifier that undermines the purpose of having a CSP at all.

**Recommended fix:**
```ts
"script-src 'self' 'unsafe-inline'" +
  (process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""),
```
For a production-grade fix, replace `'unsafe-inline'` with a per-request nonce as well.

---

### F-07 — Session token duplicated in JSON response body

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **File** | `src/routes/auth.ts` |
| **Lines** | 58–61 (register), 110–113 (login) |
| **Status** | Open |

**Finding:** Both `POST /api/auth/register` and `POST /api/auth/login` set the session token as an `httpOnly` cookie *and* include it as `data.token` in the JSON response body. A client that stores `data.token` in `localStorage` or a React state store renders that token accessible to any JavaScript running on the page — eliminating the XSS protection that `httpOnly` provides.

**Recommended fix:** Remove `token` from both response bodies. The cookie is sufficient for browser clients; mobile or CLI clients that require a Bearer token should use a dedicated token-exchange endpoint with explicit documentation of the security tradeoffs.

---

### F-08 — No security headers on Express API server

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **File** | `src/app.ts` |
| **Line** | 11–21 |
| **Status** | Open |

**Finding:** The Next.js edge middleware adds security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, CSP) to web responses, but the Express API server at `src/app.ts` applies none of these. If the API port is ever exposed directly (e.g., via misconfigured proxy, during development, or in Docker without the Next.js layer), API responses carry no security headers.

**Recommended fix:** Add `helmet` as a dependency and apply it before the route handlers:
```ts
import helmet from "helmet";
app.use(helmet());
```

---

### F-09 — Unbounded date range in metrics/dashboard queries

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **File** | `src/lib/validation/schemas.ts` |
| **Lines** | 19–32 |
| **Status** | Open |

**Finding:** The `from`/`to` query parameters accept any parseable date string and there is no validation that `from < to`, nor any cap on the query window. A request with `from=1970-01-01&to=2099-01-01` will perform a full-table sequential scan on the `metrics` table, which could be exploited for a resource-exhaustion DoS.

**Recommended fix:**
```ts
.refine((s) => s.from <= s.to, { message: "from must be before to" })
.refine(
  (s) => (s.to.getTime() - s.from.getTime()) <= 366 * 24 * 60 * 60 * 1000,
  { message: "Date range cannot exceed 366 days" }
)
```

---

### F-10 — HKDF derivation uses empty salt

| Field | Value |
|---|---|
| **Severity** | LOW |
| **File** | `src/lib/crypto/tokenEncryption.ts` |
| **Line** | 8 |
| **Status** | Open |

**Finding:** The per-repo key is derived with `hkdfSync("sha256", master, Buffer.alloc(0), String(repoId), 32)`. RFC 5869 states that an empty salt defaults to a zero-filled HMAC key, weakening domain separation slightly. While not exploitable in isolation, it reduces the margin against master-key compromise.

**Recommended fix:** Use a fixed, application-specific salt value stored alongside `ENCRYPTION_KEY`:
```ts
const salt = Buffer.from(process.env.ENCRYPTION_SALT ?? "", "hex");
hkdfSync("sha256", master, salt, `devpulse-github-token-${repoId}`, 32)
```

---

### F-11 — Sync error messages stored verbatim in database

| Field | Value |
|---|---|
| **Severity** | LOW |
| **File** | `src/lib/github/syncEngine.ts` |
| **Line** | 121 |
| **Status** | Open |

**Finding:** Uncaught errors during sync are stored as `error_message: err instanceof Error ? err.message : String(err)`. Node.js error messages can include file-system paths, environment variable names, or internal identifiers. If any API ever surfaces `SyncLog.error_message` to an end user, it may leak internal structure.

**Recommended fix:** Sanitize or categorize the error before persisting: map known GitHub API errors to user-safe messages and store raw messages in a separate, non-user-visible field or structured log only.

---

## Fixes Applied

### Fix 1 — Remove hardcoded secret fallbacks (F-01, F-02)

Files modified:
- `src/lib/auth/jwt.ts`
- `src/lib/crypto/tokenEncryption.ts`

### Fix 2 — Rate limiting on auth endpoints (F-03)

Files modified:
- `package.json` (added `express-rate-limit`)
- `src/routes/auth.ts`

### Fix 3 — Sanitize file-browser path parameter + remove token header (F-04, F-05)

Files modified:
- `src/routes/repos.ts`
- `src/middleware/authenticate.ts`

---

## Open Items (Recommended for Next Sprint)

| ID | Severity | Finding |
|---|---|---|
| F-06 | MEDIUM | Restrict `unsafe-eval` to non-production CSP |
| F-07 | MEDIUM | Remove `token` from login/register response body |
| F-08 | MEDIUM | Add `helmet` to Express API server |
| F-09 | MEDIUM | Add `from < to` and 366-day cap to date range schemas |
| F-10 | LOW | Use non-empty HKDF salt |
| F-11 | LOW | Sanitize sync error messages before DB persistence |
