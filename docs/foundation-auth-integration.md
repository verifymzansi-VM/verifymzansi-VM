# Foundation authentication integration

The foundation authentication integration is incremental. The live application
continues using its existing authentication routes until the complete cutover
has been rehearsed. Adding a foundation route does not switch the live backend.

## Password sign-in

`POST /api/foundation/auth/login` accepts only `email`, `password` and
`turnstileToken`. It requires the application's same-origin/CSRF protection and
the shared `auth:login` rate limit. Failed shared protection blocks the request.
The body is bounded to 4 KiB. Responses, including failures, disable browser and
CDN caching. Successful responses contain `{ "ok": true }`, with the session in
the target project's SDK cookies. Hosted foundation session cookies use the
`Secure` flag, including cookies refreshed by protected routes; isolated local
HTTP tests remain supported. Credentials and tokens are never returned in JSON.
No profile or role is created by signing in.

The route is disabled unless `FOUNDATION_PASSWORD_AUTH_MODE=native-captcha`. It
also requires all three separate foundation connection settings:
`FOUNDATION_SUPABASE_URL`, `FOUNDATION_PROJECT_REF` and
`FOUNDATION_SUPABASE_PUBLISHABLE_KEY`. The runtime connection validator accepts
only the approved target, or the isolated foundation database in a test runtime.
The existing application's connection settings cannot supply a fallback.

**Do not enable the mode merely because the connection settings exist.** Before
enabling it, configure and verify native Turnstile protection on the target's
Supabase Auth service. Use a production widget restricted to the intended
production hostnames, with no test keys or local development hostnames. Verify
the provider settings privately and perform a controlled real-browser rehearsal.
The mode is a deployment choice, not evidence that provider protection exists.

Supabase Auth is the CAPTCHA verifier for this path: the SDK passes the token as
`options.captchaToken` in its single password request. Do not also call the
application's Siteverify helper with that token, retry the request
automatically, or fall back to sign-in without CAPTCHA. Single-use validation
and replay rejection require real provider verification; mocked transport tests
cannot attest them. An ambiguous network failure requires a fresh CAPTCHA before
retry.

The route stages cookie writes and publishes them only after successful sign-in
of a confirmed, non-anonymous account. Invalid credentials, CAPTCHA refusals,
provider failures and cookie failures do not publish a new session. Protected
foundation operations subsequently verify the cookie token with GoTrue and apply
the database's live session, account and MFA rules. A successful sign-in does
not itself authorize staff access.

## Remaining integration

This endpoint is not a completed authentication migration. The foundation still
needs registration, confirmation callbacks, recovery, current-password changes,
MFA, sign-out and browser session integration, with their corresponding account
policies and abuse controls. The current frontend must not be pointed at this
endpoint until it handles the foundation session and subsequent onboarding.
Registration stays closed during preparation. Production cutover also requires
the remaining application domains, workers, storage and recovery verification.
Old accounts, data and administrator grants must not be imported.
