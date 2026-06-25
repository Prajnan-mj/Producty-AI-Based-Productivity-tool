# Security Audit — Producty

**Date:** 2026-06-25
**Stack (confirmed from code):** Python 3.11 · FastAPI 0.137 · **PostgreSQL** (`postgresql+asyncpg`, [database.py](backend/app/database.py)) · SQLAlchemy 2.0 async ORM · NVIDIA NIM (`meta/llama-3.1-8b-instruct`, OpenAI-compatible) · Google OAuth-only auth · document ingestion + AI flashcards/task extraction.
**Auth model:** Google OAuth 2.0 only — **no passwords are ever stored** (the `User` model has no password column).

---

## 1. Executive summary

The codebase was structurally sound on the highest-risk items before this pass: **no secrets in git** (0 commits, `.env` is gitignored — verified with `git check-ignore`), **no IDOR** (every data query filters by `user_id == user.id`), **no SQL injection** (100% parameterized ORM), and **no XSS sink** (React auto-escapes all AI output; no `dangerouslySetInnerHTML`). The real gaps were operational hardening for a move to real users: **no rate limiting** (cost-abuse on the NVIDIA key + auth brute-force), **prompt-injection** via ingested documents, **unbounded file reads** before size checks, **missing security headers**, and several **prod-config foot-guns** (permissive CORS, API docs exposed, OAuth-over-HTTP, root Docker user, unpinned deps). **All of these have been fixed in this commit.** The remaining residual risk is environment-dependent (TLS termination, hosting config) and a known acceptable tradeoff (JWT in `localStorage`).

---

## 2. Findings table

| # | Severity | File:Line | Issue | Status |
|---|----------|-----------|-------|--------|
| 1 | **HIGH** | (app-wide) no limiter | No rate limiting → one user can drain the NVIDIA quota / brute-force auth | ✅ FIXED — `RateLimitMiddleware` ([security_utils.py](backend/app/security_utils.py)): auth 15/min, AI 30/min, default 200/min, per-IP |
| 2 | **HIGH** | [capture.py:121](backend/app/routers/capture.py), [documents.py:60](backend/app/routers/documents.py) | `await file.read()` loads entire body into memory **before** the size check → memory-exhaustion DoS | ✅ FIXED — chunked read with hard cap + `file.size` pre-check (`_read_capped`) |
| 3 | **HIGH** | [capture.py:145](backend/app/routers/capture.py), [ai_service.py](backend/app/services/ai_service.py), [documents.py:210](backend/app/routers/documents.py) | Prompt injection — ingested doc/text concatenated into the LLM prompt; a malicious file can override system instructions | ✅ FIXED — `wrap_untrusted()` fences untrusted content with delimiters + a "treat as data, not instructions" guard; neutralizes delimiter-escape |
| 4 | **MEDIUM** | [auth.py:8](backend/app/routers/auth.py) | `OAUTHLIB_INSECURE_TRANSPORT=1` set unconditionally → OAuth tokens could transit over HTTP in prod | ✅ FIXED — gated behind `settings.DEBUG` |
| 5 | **MEDIUM** | [main.py:59](backend/app/main.py) | CORS `allow_origin_regex` (any localhost) + `allow_methods/headers=*` — fine for dev, unsafe for prod | ✅ FIXED — explicit allowlist (`CORS_ALLOW_ORIGINS`) + scoped methods/headers when `DEBUG=false` |
| 6 | **MEDIUM** | (no middleware) | No security headers (CSP, X-Content-Type-Options, X-Frame-Options, HSTS) | ✅ FIXED — `SecurityHeadersMiddleware` ([main.py](backend/app/main.py)); HSTS only in prod |
| 7 | **MEDIUM** | [documents.py:54](backend/app/routers/documents.py), [capture.py:124](backend/app/routers/capture.py) | File type trusted from client extension only — no magic-byte check | ✅ FIXED — `validate_upload()` verifies magic bytes vs. claimed extension |
| 8 | **MEDIUM** | [Dockerfile:12](backend/Dockerfile) | Container runs as **root** | ✅ FIXED — added non-root `appuser` (uid 10001) |
| 9 | **MEDIUM** | [requirements.txt](backend/requirements.txt) | Dependencies unpinned → non-reproducible builds, silent CVE pickup | ✅ FIXED — all versions pinned |
| 10 | **MEDIUM** | [auth.py:120,250](backend/app/routers/auth.py) | Error responses interpolate `{exc}` → leaks internal error text to client | ✅ FIXED — generic client message, real error logged server-side |
| 11 | **MEDIUM** | (no guard) | App would boot in prod with default `SECRET_KEY="change-me-in-production"` | ✅ FIXED — lifespan refuses to start if `DEBUG=false` and secret is default/<32 chars |
| 12 | **MEDIUM** | frontend `localStorage` token | JWT in `localStorage` is stealable by any XSS | ⚠️ ACCEPTED — no XSS sink exists (React escapes everything); documented. See remediation note for httpOnly-cookie option |
| 13 | **LOW** | [panic.py:158](backend/app/routers/panic.py) | Public share token only 8 bytes (64-bit) | ✅ FIXED — bumped to 16 bytes (128-bit) |
| 14 | **LOW** | [auth.py:39](backend/app/routers/auth.py) | In-memory OAuth `_pending_flows`/`_auth_codes` never expired → unbounded growth + stale one-time codes | ✅ FIXED — TTLs (flow 10min, code 2min) + sweep on use |
| 15 | **LOW** | [database.py:8](backend/app/database.py) | No connection-pool bounds (defaults only) | ✅ FIXED — explicit `pool_size`/`max_overflow`/`pool_pre_ping`/`recycle` |
| 16 | **LOW** | [main.py](backend/app/main.py) | API docs (`/docs`, `/openapi.json`) exposed unconditionally | ✅ FIXED — disabled when `DEBUG=false` |
| 17 | **INFO** | — | PII inside ingested documents is sent to NVIDIA's API | ⚠️ THREAT-MODEL NOTE — inherent to the feature; surface a consent/notice to users before prod |

### Verified safe (no issue found)

- **SQL injection** — every query uses SQLAlchemy ORM expressions (parameterized). The only raw SQL is the idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` DDL in [main.py:39](backend/app/main.py), built from **hardcoded constants with zero user input**. Safe.
- **IDOR / broken object-level auth** — spot-checked tasks, notes, flashcards, triage, capture, documents, infra, rooms: all fetch with `and_(Model.id == id, Model.user_id == user.id)`. The only unauthenticated data route is `GET /api/panic/share/{token}` — public **by design**, gated by an unguessable token (now 128-bit).
- **Password storage** — N/A. Google OAuth only; no passwords persisted. (`passlib[bcrypt]` is a transitive leftover, unused.)
- **Path traversal** — uploaded filenames are **never** used in `open()`/filesystem writes. Files are parsed in-memory; only the extracted `analysis` JSON + filename string are stored in the DB. Safe.
- **AI-output XSS** — no `dangerouslySetInnerHTML` anywhere in the frontend; all model output is rendered as React text (auto-escaped) or inserted as Tiptap **text nodes**. Safe.
- **Secrets in git** — `git ls-files` = 0 tracked files, `git log` has no commits, `git check-ignore backend/.env` confirms it's ignored, and no `nvapi-`/`GOCSPX-`/`AIzaSy` string appears in any tracked file or in the frontend bundle. The NVIDIA key lives only in `backend/.env` (local, gitignored).
- **JWT** — HS256, 64-hex-char secret, 60-min expiry, signature+expiry validated on every request ([security.py](backend/app/security.py)). OAuth `state` CSRF parameter is validated; the JWT is delivered via a one-time code (not in the redirect URL).

---

## 3. Prioritized remediation order

**All HIGH/MEDIUM items above are already fixed in code.** What remains is operational, to do **before** real users:

**Before public launch (must):**
1. Set `DEBUG=false` in the production environment (this alone activates: docs off, strict CORS, HSTS, secret-strength enforcement, HTTPS-only OAuth).
2. Set `CORS_ALLOW_ORIGINS` to the real frontend origin(s).
3. Terminate TLS in front of the app (HTTPS) — required for the OAuth and HSTS changes to mean anything.
4. Rotate the NVIDIA key and Google client secret if this repo was ever shared (they're currently in plaintext `.env`, which is correct for local dev but the values were pasted into chat).
5. Run `pip-audit` against the now-pinned `requirements.txt`.

**Soon after (should):**
6. Move the rate limiter + OAuth code store to **Redis** (the in-memory versions are per-process; multi-worker deployments need shared state). `redis` is already a dependency.
7. Add structured request logging + an error monitor (Sentry) — and confirm no document bodies/tokens are logged.
8. Consider httpOnly+Secure+SameSite cookie auth instead of `localStorage` JWT if you add any user-generated HTML rendering later.

**Can wait (nice-to-have):**
9. Per-user (not just per-IP) AI quotas for fairer cost control.
10. Postgres least-privilege role (app should not own/DROP its schema in prod; run migrations as a separate admin role).
11. Automated DB backups (managed Postgres providers give this for free — enable PITR).

---

## 4. Assumptions / things I could NOT verify from code alone

- **Actual production deployment config** — whether TLS is terminated, whether `DEBUG` is really set to `false`, reverse-proxy/WAF presence, and `X-Forwarded-For` trust (the rate limiter trusts the first hop — only correct behind exactly one trusted proxy).
- **Database privileges** — the connection string uses `postgres` superuser locally. The actual prod DB role's privileges are environment-defined and not visible here.
- **Hosting-level protections** — DDoS protection, network ACLs, and secret-manager usage are platform decisions (e.g., Render/Fly/Railway secrets vs. a raw `.env` on a VM).
- **Backup/recovery** — no backup logic in-repo; this is expected to be handled by the managed DB provider, which I cannot confirm.
- **NVIDIA data handling** — whether NVIDIA retains/trains on submitted prompts is governed by their API terms, not this code. Document content (potentially PII) is sent to them; users should be told.
- **`pip-audit` CVE status** — versions are now pinned, but I did not have `pip-audit` output to cross-check specific CVEs at audit time. Run it in CI.
