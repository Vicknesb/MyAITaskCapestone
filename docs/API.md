# DevPulse API Reference

The DevPulse backend is an Express 5 server. All endpoints are mounted under `/api`.

**Base URL (development):** `http://localhost:4000`

In production, the Next.js frontend rewrites `/api/*` to the Express server, so clients call relative paths (`/api/...`) through the Next.js origin.

---

## Authentication

DevPulse uses JWT sessions stored server-side.

**How to authenticate:**

Send the token in the `Authorization` header:
```
Authorization: Bearer <token>
```

The token is returned in the response body on login and register. It is also set as an `httpOnly` cookie (`devpulse_session`) by the server — the cookie is read by the Next.js Edge Middleware for server-side route protection.

**Session lifetime:** 7 days. Sessions are automatically renewed (new token issued via `Set-Cookie`) when fewer than 24 hours remain.

**Session invalidation:** Tokens are stored as SHA-256 hashes in the `sessions` table. Logout deletes the row; the token is immediately rejected on subsequent requests even if it is not yet expired.

---

## Table of Contents

- [Auth](#auth)
  - [POST /api/auth/register](#post-apiauthregister)
  - [POST /api/auth/login](#post-apiauthlogin)
  - [GET /api/auth/me](#get-apiauthme)
  - [DELETE /api/auth/logout](#delete-apiauthlogout)
- [Repositories](#repositories)
  - [GET /api/repos](#get-apirepos)
  - [POST /api/repos/connect](#post-apireposconnect)
  - [DELETE /api/repos/:id](#delete-apireposid)
  - [GET /api/repos/:id/files](#get-apireposidfiles)
- [Metrics](#metrics)
  - [GET /api/metrics/:repoId](#get-apimetricsrepoid)
  - [GET /api/metrics](#get-apimetrics)
- [Dashboard](#dashboard)
  - [GET /api/dashboard](#get-apidashboard)
- [Sync](#sync)
  - [POST /api/sync/:repoId](#post-apisyncrepoid)

---

## Response Envelope

Every response follows this shape:

```ts
// Success
{ "success": true, "data": <T> }

// Error
{ "success": false, "error": "<human-readable message>", "code": "<ERROR_CODE>" }
```

Error codes are machine-readable constants (`UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, etc.) suitable for programmatic handling.

---

## Auth

### POST /api/auth/register

**Auth required:** No  
**Rate limit:** 5 requests per IP per hour  
**Description:** Creates a new user account. On success, issues a session token and auto-logs the user in.

**Request body:**
```json
{
  "email": "alice@example.com",
  "password": "Password123!",
  "name": "Alice Chen"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `email` | string | Yes | Valid email format, max 255 chars |
| `password` | string | Yes | Min 8 chars, max 128 chars |
| `name` | string | No | Max 100 chars |

**Success — 201:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "clxyz123",
      "email": "alice@example.com",
      "name": "Alice Chen"
    }
  }
}
```

**Error responses:**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Email is invalid, password is shorter than 8 chars, or body is malformed |
| 409 | `EMAIL_TAKEN` | A user with that email already exists |
| 429 | `RATE_LIMITED` | Too many registration attempts from this IP |
| 500 | — | Unexpected server error (stack trace not exposed) |

---

### POST /api/auth/login

**Auth required:** No  
**Rate limit:** 10 requests per IP per 15 minutes  
**Description:** Authenticates an existing user. Returns a session token. The same error message is returned whether the email is unknown or the password is wrong (constant-time rejection to prevent user enumeration).

**Request body:**
```json
{
  "email": "alice@example.com",
  "password": "Password123!"
}
```

**Success — 200:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_at": "2026-05-26T14:30:00.000Z",
    "user": {
      "id": "clxyz123",
      "email": "alice@example.com",
      "name": "Alice Chen"
    }
  }
}
```

**Error responses:**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing or malformed request body |
| 401 | `INVALID_CREDENTIALS` | Email not found or password incorrect |
| 429 | `RATE_LIMITED` | Too many login attempts from this IP |

---

### GET /api/auth/me

**Auth required:** Yes  
**Description:** Returns the authenticated user's profile. Does not include `password_hash`.

**Success — 200:**
```json
{
  "success": true,
  "data": {
    "id": "clxyz123",
    "email": "alice@example.com",
    "name": "Alice Chen",
    "created_at": "2026-05-18T12:00:00.000Z"
  }
}
```

**Error responses:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No token, invalid token, or expired session |

---

### DELETE /api/auth/logout

**Auth required:** Yes  
**Description:** Deletes the server-side session. The token is immediately invalid even though its JWT expiry has not yet passed.

**Success — 200:**
```json
{
  "success": true,
  "data": { "message": "Logged out" }
}
```

**Error responses:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | No token or invalid token |

---

## Repositories

### GET /api/repos

**Auth required:** Yes  
**Description:** Returns all GitHub repositories connected by the authenticated user, including the status of the most recent sync.

**Success — 200:**
```json
{
  "success": true,
  "data": {
    "repositories": [
      {
        "id": "clrepo456",
        "github_repo_id": 123456789,
        "full_name": "acme-corp/frontend-app",
        "owner": "acme-corp",
        "name": "frontend-app",
        "description": "Main customer-facing React application",
        "is_private": true,
        "default_branch": "main",
        "connected_at": "2026-05-18T12:00:00.000Z",
        "last_synced_at": "2026-05-17T08:00:00.000Z",
        "sync_status": "SUCCESS"
      }
    ]
  }
}
```

**Error responses:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing or invalid session |

---

### POST /api/repos/connect

**Auth required:** Yes  
**Description:** Connects a GitHub repository to the user's account. Validates the GitHub token by making a live API call to GitHub before storing. The token is encrypted with AES-256-GCM before being persisted. A user may connect up to 10 repositories.

**Request body:**
```json
{
  "full_name": "acme-corp/frontend-app",
  "github_token": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `full_name` | string | Yes | Must match pattern `owner/repo` (alphanumeric, hyphens, dots) |
| `github_token` | string | Yes | Min 20 chars; must be a valid GitHub PAT with `repo` scope |

**Success — 201:**
```json
{
  "success": true,
  "data": {
    "id": "clrepo456",
    "full_name": "acme-corp/frontend-app",
    "github_repo_id": 123456789,
    "connected_at": "2026-05-19T10:00:00.000Z"
  }
}
```

**Error responses:**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `full_name` does not match `owner/repo` pattern, or token is too short |
| 401 | `UNAUTHORIZED` | Missing or invalid session |
| 403 | `GITHUB_TOKEN_INVALID` | GitHub returned 401 or 403 for the provided token |
| 404 | `REPO_NOT_FOUND` | Repository does not exist on GitHub or token lacks access |
| 409 | `REPO_ALREADY_CONNECTED` | This user has already connected this repository |
| 422 | `REPO_LIMIT_EXCEEDED` | User has reached the 10-repository limit |

---

### DELETE /api/repos/:id

**Auth required:** Yes  
**Description:** Disconnects a repository from the user's account. If no other users are connected to the same repository, the repository record and all its metrics are cascade-deleted.

| Parameter | Type | Description |
|---|---|---|
| `id` | string | The `UserRepository` record ID (not the `Repository` ID) |

**Success — 200:**
```json
{
  "success": true,
  "data": { "message": "Repository disconnected" }
}
```

**Error responses:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing or invalid session |
| 403 | `FORBIDDEN` | The connection exists but belongs to a different user |
| 404 | `NOT_FOUND` | No connection record with that ID |

---

### GET /api/repos/:id/files

**Auth required:** Yes  
**Description:** Proxies the GitHub Contents API for a connected repository. Returns the file and directory listing for a given path and ref. The repository's stored token is decrypted and used to authenticate the GitHub request. Path traversal sequences (`..`) and characters outside `[a-zA-Z0-9\-_./]` are rejected.

| Parameter | Type | Description |
|---|---|---|
| `id` | string | The `Repository` record ID |

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `path` | string | `""` (repo root) | Path within the repository |
| `ref` | string | Repo's `default_branch` | Branch, tag, or commit SHA |

**Success — 200:**

Returns GitHub's raw Contents API response (array of file/directory objects, or a single file object for a specific file path).

```json
{
  "success": true,
  "data": [
    {
      "name": "README.md",
      "path": "README.md",
      "type": "file",
      "size": 1234,
      "sha": "abc123...",
      "url": "https://api.github.com/repos/..."
    }
  ]
}
```

**Error responses:**

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_PATH` | Path contains `..` or disallowed characters |
| 401 | `UNAUTHORIZED` | Missing or invalid session |
| 403 | `FORBIDDEN` | Current user is not connected to this repository |
| 404 | `NOT_FOUND` | Repository ID does not exist, or path not found in repo |
| 502 | `GITHUB_ERROR` | GitHub API returned an unexpected error |

---

## Metrics

### GET /api/metrics/:repoId

**Auth required:** Yes  
**Description:** Returns stored metric snapshots for a single repository. Only returns metrics for repositories the authenticated user is connected to.

| Parameter | Type | Description |
|---|---|---|
| `repoId` | string | The `Repository` record ID |

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | ISO 8601 date string | 30 days ago | Start of the query window |
| `to` | ISO 8601 date string | Now | End of the query window |
| `type` | `COMMIT_FREQ` \| `PR_STATS` \| `ACTIVITY` \| `CONTRIBUTOR` | All types | Filter to a single metric type |

**Success — 200:**
```json
{
  "success": true,
  "data": {
    "repository": {
      "id": "clrepo456",
      "full_name": "acme-corp/frontend-app"
    },
    "metrics": [
      {
        "id": "clmet789",
        "type": "COMMIT_FREQ",
        "recorded_at": "2026-05-12T00:00:00.000Z",
        "period_days": 7,
        "payload": {
          "commit_count": 34,
          "author_breakdown": [
            { "login": "alice-chen", "count": 18, "avatar_url": "https://avatars.githubusercontent.com/..." }
          ]
        }
      }
    ]
  }
}
```

**Metric payload shapes by type:**

| Type | Payload fields |
|---|---|
| `COMMIT_FREQ` | `commit_count: number`, `author_breakdown: { login, count, avatar_url }[]` |
| `PR_STATS` | `open: number`, `merged: number`, `closed: number`, `avg_merge_time_hrs: number`, `review_count: number` |
| `ACTIVITY` | `active_days: number`, `peak_hour: number`, `push_events: number` |
| `CONTRIBUTOR` | `contributors: { login, avatar_url, commits, prs }[]` |

Metrics are stored for `period_days` values of `7` and `30`.

**Error responses:**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `type` is not one of the four valid enum values |
| 401 | `UNAUTHORIZED` | Missing or invalid session |
| 403 | `FORBIDDEN` | Repository exists but user is not connected to it |
| 404 | `NOT_FOUND` | No repository with that ID |

---

## Metrics (continued)

### GET /api/metrics

**Auth required:** Yes  
**Description:** Alias for `GET /api/dashboard`. Returns the same aggregated metrics payload across all repositories connected by the authenticated user. Accepts the same `from` / `to` query parameters. Prefer `GET /api/dashboard` for new client code — this route exists as a convenience on the metrics router.

See [GET /api/dashboard](#get-apidashboard) for the full request/response specification.

---

## Dashboard

### GET /api/dashboard

**Auth required:** Yes  
**Description:** Returns aggregated metrics across all repositories connected by the authenticated user. Computes a cross-repo summary (total commits, merged PRs, distinct active contributors, repo count) and per-repo metric payloads for the most recent snapshot of each type in the query window.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | ISO 8601 date string | 30 days ago | Start of the query window |
| `to` | ISO 8601 date string | Now | End of the query window |

**Success — 200:**
```json
{
  "success": true,
  "data": {
    "period": {
      "from": "2026-04-19T00:00:00.000Z",
      "to": "2026-05-19T00:00:00.000Z"
    },
    "summary": {
      "total_commits": 147,
      "total_prs_merged": 23,
      "active_contributors": 6,
      "repos_tracked": 3
    },
    "per_repo": [
      {
        "repository_id": "clrepo456",
        "full_name": "acme-corp/frontend-app",
        "commit_freq": { "commit_count": 34, "author_breakdown": [...] },
        "pr_stats": { "open": 3, "merged": 8, "closed": 2, "avg_merge_time_hrs": 22.5, "review_count": 16 },
        "activity": { "active_days": 5, "peak_hour": 14, "push_events": 28 },
        "contributors": { "contributors": [...] }
      }
    ]
  }
}
```

`per_repo` entries use the most recent metric snapshot of each type within the requested date window. If no snapshot exists for a type, that field is `null`.

**Error responses:**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Query params are malformed |
| 401 | `UNAUTHORIZED` | Missing or invalid session |

---

## Sync

### POST /api/sync/:repoId

**Auth required:** Yes  
**Description:** Triggers a background GitHub data sync for a repository. The response is returned immediately (HTTP 202) and the sync runs asynchronously. The sync fetches commits and pull requests from GitHub (up to 10 pages / 1,000 items each), transforms them, and upserts `Metric` rows for 7-day and 30-day windows. Only one sync per repository may run at a time.

The sync uses the repository's stored encrypted GitHub token. It fetches only data since the last successful sync (`since=<last_synced_at>`).

| Parameter | Type | Description |
|---|---|---|
| `repoId` | string | The `Repository` record ID |

**Success — 202:**
```json
{
  "success": true,
  "data": {
    "sync_log_id": "clsync999",
    "status": "PENDING"
  }
}
```

Poll `GET /api/repos` to see when `sync_status` transitions from `PENDING` → `RUNNING` → `SUCCESS` or `FAILED`.

**Error responses:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing or invalid session |
| 403 | `FORBIDDEN` | Repository exists but user is not connected to it |
| 404 | `NOT_FOUND` | No repository with that ID |
| 409 | `SYNC_IN_PROGRESS` | A sync is already running for this repository |
