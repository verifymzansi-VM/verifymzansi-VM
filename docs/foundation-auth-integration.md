# Foundation authentication integration

The foundation authentication integration is incremental. The older database is
retired. Do not deploy against it or run its migrations and schema checks on the
foundation project. Adding a foundation route does not switch the live backend;
the approved foundation build and its deployment bindings must be published.

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

## Registration and confirmation

`POST /api/foundation/auth/register` accepts `displayName`, `email`, `password`,
`confirmPassword`, `acceptTerms` and `turnstileToken`. It uses the same request
protections as sign-in and the shared registration rate limit. New passwords
must have 12–128 characters and pass the breach check; an unavailable breach
check stops registration. This application check does not attest the separate
Supabase plan's native leaked-password protection or direct Auth API behavior.

Only the validated display-name claim is passed as user metadata. The target's
Auth trigger creates the private profile. Registration does not create a staff
role or a verified identity. Posting-terms acceptance remains a separate,
authenticated action for each terms version. The registration reply contains no
user id, session or provider diagnostic. Existing-address refusals receive the
same reply and random verification-cookie state as accepted requests.

Registration remains disabled unless `FOUNDATION_REGISTRATION_ENABLED=true`,
`FOUNDATION_AUTH_CALLBACK_ENABLED=true` and the native CAPTCHA mode are all set.
Keep those settings empty until provider and browser acceptance is complete.
Hosted Supabase signup must also remain closed during preparation.

Confirmation links use `/auth/callback?backend=foundation`. The pinned SDK's
`appendPkceFlowIdToRedirects` option adds `sb_flow_id`, selecting one pending
verification cookie. The handler requires this selector and never borrows a
different flow's verifier. It exchanges the code once, then verifies the new
account with GoTrue before publishing session cookies. Confirmation redirects to
the account completion page and clears the credential query from the URL. An
unsuccessful attempt clears its verification state without publishing a new
session; other pending confirmation attempts stay separate. Caller-controlled
recovery markers cannot grant recovery authorization through this signup path.

## Browser integration

`NEXT_PUBLIC_DATA_BACKEND` selects the compiled browser integration. Its default
is `source`. The `foundation` build requires the approved target URL and a
publishable key; changing the selection requires a new build. The browser uses
its own API-schema client, never the source client's singleton. Old-project
cookies cannot identify a foundation session. The account store reads the
verified `/api/foundation/auth/session` response and drops stale account data
when accounts change or requests fail. Role hints come from the canonical
account context; each protected server operation still enforces authorization.

The foundation registration screen sends the shared validated registration
payload. The sign-in screen uses the native endpoint and refreshes the document
after success. Both require a fresh security challenge after an unsuccessful
attempt. Source confirmation-resend controls are hidden. These screens do not
enable the backend or hosted signup.

## Google sign-in

The shared Google button uses foundation PKCE when the compiled backend is
`foundation`. Its same-origin, CSRF-protected POST uses shared login rate
limiting and first checks that Google is enabled on the approved project's Auth
service. Disabled or unreachable providers fail without issuing verifier
cookies. The redirect is pinned to that project's authorize endpoint. The
callback requires `backend=foundation`, `oauth=google`, one code and one
explicit `sb_flow_id`. Session cookies are published only after code exchange
and fresh GoTrue user verification with a Google identity. Recovery callbacks
cannot use this path. The return destination is restricted to an internal path.
No source profile or service-role client is used.

Reuse the existing Google OAuth web client, registering
`https://gntzjtuncsyefujajmjy.supabase.co/auth/v1/callback` in Google Cloud.
Configure that client's ID and secret in the foundation project's Google
provider and allow the app's `/auth/callback` URL with PKCE query parameters in
Supabase. Secrets belong only in provider settings. A real Google consent
roundtrip and account/profile session check are required before claiming
provider readiness.

Protected-page routing also selects the foundation account context when the
compiled backend is `foundation`. It forwards refreshed cookies downstream and
to the browser, refuses unavailable or forbidden account contexts, checks the
verified phone rather than a cached phone hint, and directs unready staff to
two-step verification. Source browser fixtures cannot satisfy this check. Page
layouts and API commands must still enforce their own authorization.

The `source` selection remains for synthetic regression fixtures during the
conversion. It is not a production deployment target. The isolated
source-browser test explicitly pins that selection; its success cannot establish
foundation browser or provider readiness. Production requires the approved
`foundation` build after the remaining integration is accepted.

## Server sessions and authenticator setup

Protected server-rendered pages verify the current cookie token with GoTrue and
read the same canonical account context. They do not rotate refresh tokens or
attempt cookie writes; routing owns session refresh. Cookie user metadata cannot
grant a role. Staff access requires the current native readiness decision and
the exact assigned capabilities. A legacy role label used by navigation does not
add permissions.

An ordinary signed-in account can set up its authenticator at
`/dashboard/security` before an administrator is explicitly appointed. Setting
up a factor never grants staff status. Native verification starts a fresh
document so server guards receive the updated session. Real-user enrolment and
provider/browser acceptance remain separate from synthetic component tests.

## Recovery entry and callback

`POST /api/foundation/auth/recovery/request` uses native CAPTCHA, same-origin
request proof, shared network/recipient protection and an explicit PKCE slot.
Its accepted reply does not reveal whether an address has an account. Recovery
links return through `/auth/callback?backend=foundation&recovery=1`. The
selector chooses routing only; a signup code or edited verifier suffix cannot
grant recovery authority. The exact GoTrue-verified token must contain a recent
signed `recovery` authentication method, and the live profile guard must accept
its session before cookies are published.

`FOUNDATION_RECOVERY_ENABLED` stays empty while reset completion and its browser
integration remain unfinished. The local request/mail/callback rehearsal does
not establish hosted email delivery, real CAPTCHA acceptance or reset
completion.

## Current-password changes

`POST /api/foundation/auth/password` verifies the live caller and canonical
account, applies shared network/account limits, and requires the current
password with a matching new password of 12–128 characters. An unavailable
breach check stops the operation. The provider receives one update using the
exact verified token and enforces its current-password and MFA rules. A second
password sign-in cannot replace the existing two-step session.

The account security page submits this native command. In foundation mode the
older `/api/auth/change-password` URL delegates to the same handler. Replies
contain no credentials or provider diagnostics, and an unavailable notification
does not repeat an already committed password update. Native Auth must be
enabled before this route accepts commands.

## Phone completion

The foundation account-completion screen uses `POST /api/foundation/phone/send`
and `POST /api/foundation/phone/verify`. Both require a verified account,
same-origin/CSRF proof and shared abuse protection. Send protection applies to
the network, the account and the recipient across accounts. The server obtains
the subject from the caller-bound account context; submitted account selectors
are refused. SQL bounds attempts and expiration and checks contact-change rules.

Only trusted service RPCs create, claim and finalize challenges. The code digest
uses a separate random server key, `FOUNDATION_PHONE_OTP_KEY`, and binds the
account, phone and random nonce. Browser replies contain no code or stored
digest. Delivery is attempted once by the adapter. The browser keeps pending
state separate for each account and refreshes the canonical verified phone.

Keep `FOUNDATION_PHONE_VERIFICATION_ENABLED` empty until the new key, service
binding, shared limiter and SMS provider acceptance are ready. Automated tests
use synthetic delivery; they do not establish real SMS delivery. Hosted
foundation data retains production security checks even in local development.

## Deployment connection

The deployment workflow takes the public URL/key and the server credential from
the `FOUNDATION_SUPABASE_*` settings. The older `SUPABASE_SERVICE_ROLE_KEY` name
is a compatibility alias for the same modern foundation server key. No secret
value belongs in Wrangler variables. Wrangler's public connection must agree
with the compiled `foundation` selection.

`preflight:foundation` refuses mixed projects or keys and verifies the reviewed
release assembly. An unreleased assembly produces `INCOMPLETE` before network
checks. Once accepted, it checks the anonymous/service API contracts and hidden
schemas. It does not run the retired database's public-table checks or establish
authenticated, provider, storage or recovery acceptance by itself. Publishing
configuration changes alone does not switch the running website.

## Remaining integration

This endpoint is not a completed authentication migration. The foundation still
needs provider/browser acceptance of registration and confirmation, recovery,
current-password changes, MFA and complete browser session integration, with
their corresponding account policies and abuse controls. The current frontend
must not be switched until its server guards and remaining services handle
foundation sessions and onboarding has deployment/provider acceptance.
Registration stays closed during preparation. Production cutover also requires
the remaining application domains, workers, storage and recovery verification.
Old accounts, data and administrator grants must not be imported.
