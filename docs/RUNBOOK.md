# VerifyMzansi — Operations Runbook

> Operational procedures for maintaining and operating the VerifyMzansi
> platform.
>
> Production runs the foundation backend (`database/foundation/`); browsers have
> no table access and every read and write goes through `api.*` functions.
> Sections marked "Historical" describe the retired source backend. Merging into
> `main` is a production release. Read [AGENTS.md](../AGENTS.md) first.

---

## Table of Contents

- [Secret Rotation](#secret-rotation)
  - [Ozow Webhook Secret (Svix)](#ozow-webhook-secret-svix)
  - [Ozow Webhook Subscription Setup](#ozow-webhook-subscription-setup)
- [Cloudflare MCP](#cloudflare-mcp)
- [Feature Flags](#feature-flags)
- [Supabase Access Boundaries](#supabase-access-boundaries)
- [DSAR Processing](#dsar-processing-popia)
- [Audit Logs](#audit-logs)
- [Deployment & Rollback](#deployment--rollback)
- [Database Backups](#database-backups)
- [Monitoring and Alerts](#monitoring-and-alerts)
- [Sentry Bug Finding](#sentry-bug-finding)
- [KYC Provider Management](#kyc-provider-management)
- [Incident Response](#incident-response)

---

## Cloudflare MCP

Use [docs/cloudflare-mcp.md](cloudflare-mcp.md) as the operator guide for
Cloudflare MCP in this workspace.

The intended setup is:

- Use `.vscode/mcp.json` as the primary VS Code/Copilot configuration.
- Treat `.mcp.json` as the remote-endpoint reference for clients that support
  direct remote MCP configuration.
- Validate MCP with read-only queries against the Cloudflare resources bound in
  `wrangler.toml` before attempting any mutating action.

Do not treat `npx -y @cloudflare/mcp-server-cloudflare init` as the primary
setup path for this workspace. That flow is oriented around Wrangler auth and a
Claude Desktop installation flow, while this repo uses workspace MCP config in
VS Code.

This keeps Cloudflare MCP aligned with the repo's actual production footprint:
R2 storage, OTP rate limiting in KV, OpenNext cache Durable Objects, and the
main Workers deployment.

### Cloudflare MCP Token Policy

Use least-privilege Cloudflare credentials for MCP access.

- Start with read-only access for inspection tasks.
- Scope access to the resources this repo actually uses: the `verifymzansi`
  Worker deployment, the `verifymzansi-public` and `verifymzansi-private` R2
  buckets, and the KV namespace bound as `OTP_RATE_LIMITS`.
- Add broader permissions only for approved workflows such as observability,
  build inspection, or intentional operational changes.
- If MCP starts on one machine but not another, compare local Cloudflare or
  Wrangler auth state before changing workspace config.

#### Recommended Token Split

Use separate tokens by workflow instead of one catch-all token.

- Baseline read-only token: Worker read access for `verifymzansi`, R2 read
  access for `verifymzansi-public` and `verifymzansi-private`, KV read access
  for `OTP_RATE_LIMITS`, and read access for Worker binding or Durable Object
  inspection.
- Optional observability token: Additional read access for logs, analytics, or
  Workers build inspection when needed for troubleshooting.
- Separate write-capable token: Created only for reviewed maintenance workflows
  that must mutate Cloudflare state.

#### Token-Scope Rules

- Prefer resource-scoped access over account-wide access.
- Prefer read-only access by default.
- Add write access only to the smallest Cloudflare surface needed for the
  approved task.
- Avoid unrelated product scopes such as DNS, WAF, or other account features
  unless the workflow explicitly requires them.
- If Cloudflare dashboard permission labels differ from this document, choose
  the narrowest permission set that satisfies the capability baseline above.

---

## Supabase Access Boundaries

Historical: describes the retired source backend. On foundation, server code
calls `api.*` functions through `src/lib/foundation/` (request-scoped for the
signed-in caller, trusted service commands only where the function requires
them). New code must not use the `@/lib/supabase/*` table clients described
below.

Use the narrowest Supabase client that matches the workflow.

### Default Rule

- Prefer the user-scoped client from `@/lib/supabase/server` or
  `@/lib/supabase/client` for any route or page that is acting on behalf of the
  authenticated account holder.
- Use the service-role client from `@/lib/supabase/admin` only when the workflow
  is intentionally backend-only and must bypass RLS.

### User-Scoped RLS Paths

These flows should use the authenticated user's Supabase session as the primary
data access path:

- Owner-managed reads of listings, promotions, and businesses.
- Owner-managed updates and deletes for listings, promotions, and businesses.
- Dashboard reads that only need the current account holder's data.
- Public detail routes where visibility is already modeled by RLS and the route
  should not broaden access with a service-role read.

Current examples:

- `src/app/api/listings/[id]/route.ts`
- `src/app/api/promotions/[id]/route.ts`
- `src/app/api/businesses/[id]/route.ts`
- `src/app/api/content/delete/route.ts`
- `src/app/api/content/resubmit/route.ts`
- `src/app/dashboard/promotions/page.tsx`

### Intentional Service-Role-Only Paths

These operations are expected to use `createAdminClient()` because they are not
normal end-user data access paths:

- Moderation and enforcement routes under `src/app/api/admin/**` after
  authentication and role checks succeed.
- Audit and compliance writes such as `consent_records`.
- Analytics or internal writes such as `listing_views`.
- Cleanup queue writes such as `r2_cleanup_queue`.
- Webhook and system jobs that run without an end-user session.
- KYC artifact access, evidence logging, and other backend-only review
  operations.

### Review Checklist For New Routes

- [x] Admin evidence desk fetches artifacts via POST body (not GET query params)
- [x] Admin Evidence Desk navigation uses clean URL (no stepId/userId query
      params)

Before introducing `createAdminClient()` in a route, answer these questions:

1. Is this route acting on behalf of the signed-in owner of the data?
2. Does RLS already model the intended visibility or write permission?
3. Would a user-scoped client return the same row set without broadening access?
4. Is the service-role client being used only for a backend side effect such as
   cleanup, analytics, or audit logging?

If the answer to the first three questions is yes, use the user-scoped client
for the primary fetch or write.

### Audit Expectations

- For moderator-or-admin routes, derive the actor role from normalized auth
  metadata rather than hard-coding `admin` in audit records.
- If a route allows both moderators and admins, the audit log should preserve
  which staff role actually performed the action.
- If a route is admin-only, keep the stricter role gate explicit instead of
  relying on convention.

### Common Regression Pattern

Avoid this pattern:

1. Fetch row with `createAdminClient()`.
2. Check `owner_id === user.id` in application logic.
3. Write with `createAdminClient()`.

That pattern works functionally, but it weakens defense-in-depth because a
future route bug can silently bypass the intended RLS boundary.

Prefer this pattern instead:

1. Authenticate the caller.
2. Use the user-scoped client for the primary fetch.
3. Let RLS constrain row visibility.
4. Keep explicit owner checks when they improve UX or protect against policy
   regressions.
5. Use the admin client only for backend-only side effects that truly require
   it.

---

## Secret Rotation

Production is the `verifymzansi` Cloudflare Worker on `verifymzansi.com` (see
`wrangler.toml`). "Updating a production secret" below depends on the name:

- The Deploy workflow (`.github/workflows/deploy.yml`) installs only the names
  listed in `scripts/prepare-cloudflare-candidate-secrets.mjs` (passed with
  `--secrets-file`); that script is the source of truth. Update those in the
  GitHub `production` environment (see "Where secrets live"), then redeploy.
- Every other secret is inherited from the current Worker version and is never
  set by a deploy. Rotate it with `pnpm wrangler secret put <NAME>`. That
  includes the Ozow secrets (`OZOW_CLIENT_*`, `OZOW_SITE_CODE`,
  `OZOW_WEBHOOK_SECRET`, the refund keys), `RESEND_API_KEY`,
  `AFRICASTALKING_API_KEY` and the `R2_*` keys. Changing only the GitHub secret
  of such a name changes nothing in production.

"Redeploy" below means a new release through the Deploy workflow.

### Where secrets live

- **Cloudflare (Worker secrets)** hold every value the running site needs. The
  runtime-only keys `KYC_ENCRYPTION_KEY`, `ID_ENCRYPTION_KEY`, `HMAC_SECRET` and
  `IP_HASH_SECRET` live **only** here; no workflow reads them. Release
  validation (`validate-launch-env.ts --runtime-secrets-in-cloudflare`) accepts
  their absence, and `pnpm cloudflare:secrets:check` (run by every deploy)
  confirms they exist on the Worker by name.
- **GitHub environment `production`** (deployment branch: `main` only) holds the
  values the Deploy and Cloudflare Candidate workflows read. Only those jobs can
  read them, and each step receives only the values its scripts read
  (`src/__tests__/workflow-secret-scope.test.ts` lists the steps allowed any).
  Dependency installation, the build (`scripts/build-cloudflare-release.mjs`,
  which uses synthetic private values and refuses to run beside a real one),
  browser installation and upload steps receive none, and the deploy deletes its
  temporary secret files right after the last deploy step. Code installed
  earlier in the same job still runs later beside secrets, so dependency review
  remains a control.
- **GitHub environment `backup`** (deployment branch: `main` only) holds the
  backup job's database password (`SUPABASE_BACKUP_DB_PASSWORD`), its storage
  token limited to the backup bucket (`BACKUP_R2_ACCESS_KEY_ID`,
  `BACKUP_R2_SECRET_ACCESS_KEY`) and `R2_ACCOUNT_ID`. The backup and backup
  freshness jobs read it; the deploy jobs cannot.
- **GitHub environment `staging`** holds the `STAGING_*` values (see "Staging
  copy").
- **Repository-level secrets** hold only what pull-request CI and scheduled
  monitoring need (for example `DOCKERHUB_TOKEN`, `SITE_MONITOR_API_KEY`,
  `PRODUCTION_APP_URL`, the heartbeat URLs). Any workflow on any branch can read
  them, so never keep a production credential there once the environments exist.

How GitHub resolves a name: a job that names an environment reads that
environment's secret first and falls back to the repository-level secret of the
same name when the environment has none. A job that names an environment that
does not exist yet makes GitHub create it, empty and with no protection rules,
so until the owner configures `production` and `backup` the workflows keep
reading the repository-level copies exactly as before. Protection starts only
once the environment is limited to `main` and the copies are moved into it and
deleted from the repository level.

Keep the canonical copy of each value in the owner's password manager. GitHub
secrets cannot be read back; moving one means entering it again.

### Supabase Keys

1. Go to Supabase Dashboard → Settings → API
2. Rotate the `service_role` key
3. Set the new secret key as `FOUNDATION_SUPABASE_SECRET_KEY` in the GitHub
   `production` environment. The next deploy installs it on the Worker under
   both `SUPABASE_SERVICE_ROLE_KEY` and `FOUNDATION_SUPABASE_SECRET_KEY`.
4. Redeploy the application
5. Verify `/api/health` returns 200

> **Note:** The `anon` key is public and does not need rotation unless
> compromised.

### Ozow Credentials

#### OAuth Client Credentials

1. Log in to the Ozow merchant or developer portal
2. Rotate the OAuth client credentials
3. Update the production secrets:
   - `OZOW_CLIENT_ID`
   - `OZOW_CLIENT_SECRET`
   - `OZOW_SITE_CODE`
4. Confirm `OZOW_ENV=production`
5. Confirm Card Payments are enabled for the same Ozow merchant/site code if
   customers must be able to pay with Visa or Mastercard.
6. Redeploy and test a hosted checkout transaction, including the card option on
   the Ozow-hosted checkout page.

#### Ozow Webhook Secret (Svix)

The webhook endpoint uses Svix-style signature verification (`svix-id`,
`svix-timestamp`, `svix-signature`). The secret is stored in
`OZOW_WEBHOOK_SECRET` and consumed by `verifyOzowWebhookSignature()` in
`src/lib/payments/ozow.ts`.

**Rotation procedure:**

1. In the Ozow portal, navigate to the webhook subscription management page
2. Rotate (or regenerate) the webhook signing secret for the VerifyMzansi
   endpoint — Ozow may expose this via `GET /v1/webhooks/{id}/secret`
3. Copy the new secret (base64-encoded Svix signing key)
4. Update the Worker secret (the Deploy workflow does not install this one):
   ```bash
   pnpm wrangler secret put OZOW_WEBHOOK_SECRET
   ```
5. Redeploy the application
6. Send a test webhook from the Ozow dashboard or trigger a small test payment
7. Verify the webhook is accepted (HTTP 200) — check application logs for
   `"Ozow webhook signature valid"` audit event
8. Confirm no `403` or `"invalid signature"` errors in logs

> **Timing:** Rotate during low-traffic hours. There is a brief window between
> secret update and redeploy where incoming webhooks signed with the new secret
> will fail verification against the old secret. Keep this window as short as
> possible.

#### Ozow Webhook Subscription Setup

To register or update the VerifyMzansi webhook endpoint with Ozow:

1. **Endpoint URL:** `https://<DOMAIN>/api/webhooks/ozow`
   - Production: `https://verifymzansi.com/api/webhooks/ozow`
2. **Method:** POST
3. **Events to subscribe:** `transaction.complete` (covers successful and failed
   transactions)
4. **Signature format:** Svix — Ozow sends `svix-id`, `svix-timestamp`, and
   `svix-signature` headers
5. **Setup steps:** a. Log in to the Ozow portal → Webhooks section b. Create
   (or update) a webhook subscription pointing to the endpoint URL c. Select the
   `transaction.complete` event type d. Copy the signing secret provided by Ozow
   e. Store the secret as the `OZOW_WEBHOOK_SECRET` production secret f. Deploy
   and verify using the test webhook feature in the portal
6. **Verification checklist:**
   - [ ] Webhook returns HTTP 200 for valid signatures
   - [ ] Webhook returns HTTP 403 for missing or invalid signatures
   - [ ] Payment fulfillment completes (status transitions to `completed`)
   - [ ] Audit log entry is written for the webhook event
   - [ ] Amount and currency match validation passes

### KYC Provider Webhook Secret

Historical: describes the retired source backend. Before deploying the callback
handler, `20260930170000_atomic_kyc_provider_webhook.sql` was applied through
the source backend's backed-up migration command (`supabase:db:push:safe`, since
removed). Foundation database updates follow
[AGENTS.md](../AGENTS.md#database-changes). The service-only
`apply_kyc_provider_webhook` RPC commits provider evidence, pending-step risk
and audit in one transaction. Missing migrations or failed writes return HTTP
500 so the provider retries; duplicates return HTTP 200 without replaying risk
changes. Staff-decided steps and uploads replaced in the verification session
are preserved. Callback bodies are limited to 256 KiB and HMAC signatures must
be exactly 64 hexadecimal characters.

This migration does not replay callbacks previously acknowledged by the old
handler. If a real asynchronous provider was used, reconcile its delivery
history against pending verification cases and retry affected events through the
provider after deployment. Keep manual review active during reconciliation.

1. Rotate the KYC provider webhook signing secret in the provider dashboard.
2. Update the `KYC_WEBHOOK_SECRET` production secret.
3. Run `pnpm validate:launch-env` and `pnpm preflight:prod` before deploy.
4. Redeploy and verify `/api/webhooks/kyc/provider` rejects unsigned or
   invalidly signed requests.

### R2 (Cloudflare Storage) Keys

1. Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens
2. Create a new token with the same permissions
3. Update the production secrets:
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
4. Redeploy and verify file upload works
5. Revoke the old token

### Encryption Keys (KYC, ID, HMAC)

> **⚠️ CAUTION:** Rotating encryption keys will make previously encrypted data
> unreadable. Plan a migration strategy first.

1. Generate new 64-char hex keys:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. To rotate without data loss:
   - Add new key as `KYC_ENCRYPTION_KEY_NEW` (or equivalent)
   - Deploy code that decrypts with old key and re-encrypts with new key
   - Once all data is migrated, swap to the new key
3. Keys to rotate:
   - `KYC_ENCRYPTION_KEY` — KYC document encryption
   - `ID_ENCRYPTION_KEY` — SA ID number encryption
   - `HMAC_SECRET` — Deduplication hashing

### Resend (Email) API Key

1. Go to Resend Dashboard → API Keys
2. Create a new key with the same permissions
3. Update the `RESEND_API_KEY` production secret
4. Redeploy and send a test email
5. Revoke the old key

### Africa's Talking (SMS/OTP) API Key

1. Go to Africa's Talking Dashboard → Settings → API Key
2. Generate a new key
3. Update the `AFRICASTALKING_API_KEY` production secret
4. Redeploy and test OTP sending
5. Deactivate the old key

### Cloudflare Turnstile

1. Go to Cloudflare Dashboard → Turnstile
2. Rotate the secret key for your site
3. Update the production secrets:
   - `TURNSTILE_SECRET_KEY`
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (if site key changed)
4. Redeploy and verify CAPTCHA works on login/register pages

---

## Feature Flags

### Viewing Current Flags

- Admin Panel: `/admin/feature-flags`
- Database: `SELECT * FROM feature_flags ORDER BY key;`

Province/city confirmation uses `kyc_v2_flow`. The old GPS endpoint has been
removed. New proof-of-address uploads are retired (HTTP 410); users select
province and city and receive automatic location approval.

### Toggling a Flag (Legacy)

Historical: describes the retired source backend (its `feature_flags` table and
the old `pages.dev` address no longer exist).

```bash
curl -X POST https://verifymzansi.com/api/admin/feature-flags/toggle \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"key": "kyc_v2_flow", "enabled": true}'
```

### Canary Rollout

```bash
# Enable for 10% of users
curl -X POST https://verifymzansi.com/api/admin/feature-flags/toggle \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"key": "new_checkout", "mode": "percent", "percent": 10, "reason": "Gradual rollout"}'

# Enable for specific roles only
curl -X POST https://verifymzansi.com/api/admin/feature-flags/toggle \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"key": "admin_v2", "mode": "allowlist", "allowlist_roles": ["admin", "moderator"], "reason": "Staff testing"}'
```

### Emergency Flag Disable

1. Go to Admin Panel → Feature Flags
2. Toggle the flag off
3. Or via API: `{"key": "<flag>", "enabled": false}`
4. All changes are audit-logged

The feature flag rollback playbook is kept outside the public repository.

---

## DSAR Processing (POPIA)

> Privacy requests (access, correction, deletion, objection) are answered within
> **30 days**. An access request may be extended once, before its deadline, with
> written notice; a deletion request cannot be extended.

Everything below uses the live (foundation) backend. The old tables
(`dsar_requests`, `seller_profiles`, `verification_sessions`, `listings`,
`audit_events`) and "soft delete" no longer exist; never use them.

### Processing a Request

1. Requests arrive from the `/dsar` page (a signed-in member: the account is
   checked by its session), by email (staff record it in **Admin → DSAR**, with
   a manual identity check), or, once M1.6c ships, from **Delete account** (a
   deletion request is recorded automatically when the member closes the
   account).
2. Work in **Admin → DSAR** (`/admin/dsar`). You need the admin or governor role
   and an authenticator code from the last 15 minutes. You can never process
   your own request, and the database refuses it.
3. Verify the identity: a session request is already tied to its account; a
   manual (email) request is matched to the one confirmed account with exactly
   that email address. If there is no match or more than one, ask for more
   information; never guess the account.
4. Access: use **Export** (the database builds the member's own data), check it,
   and send it to the address on the request.
5. Correction or objection: make the change through the normal staff screens and
   complete the request with a short note.
6. Deletion: follow the two-person procedure below.
7. Complete the request on the screen. The database sends the "completed" notice
   to the address on the request; nothing else needs logging.

### Deletion requests: two-person procedure

What "delete my account" does (owner decision OD-10, database update
`20261116175757_close_and_erase_account.sql`):

- **At once:** the account is closed. Its posts leave the site, sign-in is
  blocked and every session ends.
- **After 30 days:** the retention job (every 5 minutes) erases the account:
  posts, enquiries it received and sent, photos and videos (queued for deletion
  from storage), profile, drafts, notifications, consent records, organisation
  roles and the sign-in itself. Paid time ends.
- **Kept:** payment records, invoices, Multi-listing packages and partner
  commissions for 5 tax years, with no link to the person; the identity-ban
  fingerprint and the trial fingerprint for their own periods; the verification
  history for 5 years after closure; reports and released legal holds for their
  own periods. The empty Auth row is deleted automatically once nothing kept
  names it.
- **Waits:** the erasure does not run while any of these applies: a legal hold,
  an open fraud hold, a staff content hold, an open report about the person or
  their posts, a staff role, a rejected deletion request, a pending payment, a
  paid order still to be delivered, an open refund, a bank transfer waiting for
  confirmation, an unpaid invoice, or an unpaid commission owed to the person as
  a partner. The reason is recorded and the job tries again an hour later.
- **Deadline:** a deletion request is due 7 days after the 30-day grace period
  ends.
- **Rejected requests:** rejecting a deletion request of a closed account places
  a legal hold ("Deletion request rejected; review by <date>", 12 months on) and
  records the rejection, so nothing erases the account on its own. At the review
  date decide: keep the hold, or release it and handle a new request. Privacy
  staff place this hold by rejecting the request; releasing it needs the
  legal-hold role (`legal_hold:manage`).
- **Closed requests:** once a completed or rejected request's last notice is
  sent (or 30 days after it closed), its email is replaced by "removed" and its
  phone and description are cleared; the record is deleted 5 years after it
  closed (provisional periods; the lawyer confirms).
- **Cannot be undone.** Take a fresh backup before the first real use in
  production, and rehearse this procedure once on staging with a test account.

Two staff members take part: **Person A** checks the identity, **Person B**
orders the erasure. The database refuses Person B if Person B also verified the
identity.

1. **Person A: check the identity** (step 3 above) and press **Verify
   identity**.
2. **Person A: check what must be kept.** Look for open reports, fraud holds or
   a legal reason to keep data (a dispute, a court order, a police request). If
   there is one, place a legal hold with the reason and tell the person what is
   kept and why. A hold makes the erasure wait; it does not stop the closure.
3. **Person A: approve** the request (it moves to "in progress").
4. **Person A: paid time.** If the account still has paid time and belongs to a
   natural person, closing counts as a cancellation request (refund policy, rule
   8): after 20 business days the unused whole days are credited at the plan's
   daily rate, minus R50. Record the credit with the slot refund (reason
   "s14_cancellation") before the erasure runs. Companies, close corporations
   and trusts get no credit. An open refund makes the erasure wait.
5. **Person B: order the erasure.** Once M1.6c ships this is the **Erase
   account** button on the request. Until then Person B runs this reviewed
   command in the owner's Supabase SQL editor, with Person A watching and
   checking each value (replace the two placeholders):

   ```sql
   select internal.order_account_erasure('<request id>', null, '<Person B staff account id>');
   ```

   It does exactly what the button will do: it refuses unless the request is a
   verified deletion request in progress, Person B holds the privacy role, is
   not the requester and did not verify the identity, and the account is not a
   staff account; then it closes the account, links the request, records the
   order on the request and sets its deadline. It returns the erasure state.

6. **Wait 30 days.** The retention job erases the account on its own. To see
   where it stands, read the state (read only):

   ```sql
   select internal.account_erasure_state(user_id)
   from private.account_erasure_requests where request_id = '<request id>';
   ```

   `scheduled` waits for the 30 days, `held` names what it waits for
   (`held_by`), `erased` means the content and sign-in are gone, `removed` means
   the Auth user is deleted too. If it stays `held` with `error` (the retention
   job also logs the alert `account_erasure_errors`), report it as an incident.
   What to do for the other reasons:

   - `invoice_unpaid`: void the unpaid invoice (Admin → Payments → Invoices), or
     record its payment if the money arrived.
   - `commission_unpaid` (the person is a partner): pay out the commission and
     record the payout, or forfeit it (reverse it with the reason), so nothing
     is owed.
   - `report_open`: decide the open reports about the person or their posts.
     Open reports can delay the erasure past the request's deadline: decide them
     before the deadline, and if one needs longer, tell the person in writing
     that the erasure waits for the review and why.
   - `payment_pending`, `payment_unresolved`, `refund_open`, `transfer_waiting`:
     finish the payment step (wait for Ozow, deliver or refund, confirm or
     decline the transfer).
   - `legal_hold`, `fraud_hold`, `content_hold`: the erasure waits until staff
     release the hold.

   A refund or chargeback of a payment whose account was erased always needs a
   second staff member's approval.

   The Auth sign-in log is cleared in one bounded batch (entries since the
   account was created, up to 10,000); older or further entries leave with the
   normal Auth log retention.

7. **Person A: complete the request** with the attestation ("Erased under the
   deletion rules on <date>; payment records kept 5 years without the person").
   The database refuses to complete a deletion request before the account is
   erased, or one naming an account before the erasure was ordered. A request
   that names no account (no match) is completed with the attestation only.

A staff member's own account is never erased this way: end their roles first
(staff governance), then process the request.

### Monitoring DSAR Deadlines

**Admin → DSAR** lists open requests with their deadlines, earliest first. Read
only, in the SQL editor:

```sql
select id, type, status, received_at, effective_due_at,
       case when now() > effective_due_at then 'OVERDUE' else 'OK' end as compliance
from private.privacy_requests
where status in ('submitted', 'identity_pending', 'in_progress')
order by effective_due_at;
```

A deletion request closed by the member is answered after the 30-day grace
period, so it can show as overdue by a day or so; complete it as soon as the
erasure has run.

---

## Audit Logs

### Viewing Audit Events

- Admin Panel: `/admin/audit-logs`
- Direct query:

  ```sql
  SELECT * FROM audit_events
  ORDER BY created_at DESC
  LIMIT 100;
  ```

### Key Audit Event Types

| Event                 | Description                         |
| --------------------- | ----------------------------------- |
| `login`               | User authentication                 |
| `kyc.submit`          | KYC verification submitted          |
| `kyc.decide`          | Admin KYC decision (approve/reject) |
| `feature_flag.toggle` | Feature flag changed                |
| `listing.create`      | New listing created                 |
| `listing.boost`       | Listing boosted                     |
| `content.flag`        | Content flagged for review          |
| `content.decide`      | Moderation decision                 |
| `dsar.request`        | DSAR submitted                      |
| `payment.complete`    | Payment processed                   |

### Compliance Checks

```sql
-- Failed audit writes (check for gaps)
-- The application tracks auditFailureCount in the logger
-- Monitor for any audit gaps via:
SELECT date_trunc('hour', created_at) AS hour, COUNT(*)
FROM audit_events
GROUP BY 1
ORDER BY 1 DESC
LIMIT 48;
```

---

## Deployment & Rollback

### Standard Deployment

Successful push CI on the current `main` commit starts the Deploy workflow.
Manual dispatch remains available. Pull requests, forks, failed CI and older
queued commits cannot publish production. Both paths retain the foundation
release-acceptance preflight; an unreleased assembly blocks activation.

The production build takes its public settings from `wrangler.toml`, then
installs the app's scoped secrets with the same atomic code deployment. The
limiter, cleanup and operations Workers receive their matching shared keys. The
live deployment is tagged with the Git commit for traceability. Candidate
uploads remain manual and inactive; their successful upload is not a release.

Database updates are not part of the deploy. A foundation update is a new file
in `database/foundation/updates/` that travels in the same pull request as its
code; the owner applies it after the merge and before that code is deployed
([AGENTS.md](../AGENTS.md#database-changes)).

Historical: describes the retired source backend. For the 30 September 2026
audit changes, the pending migrations were applied through the source backend's
`supabase:db:push:safe` command (since removed) before deploying the application
(the database test lanes run then were removed on 11 November 2026).
`20260930170000_atomic_kyc_provider_webhook.sql` supplies the callback RPC;
`20260930180000_role_predicates_security_invoker.sql` removes unnecessary
elevation from three caller-scoped predicates while preserving their grants. The
latter requires the preceding staff MFA and organisation column-privacy
migrations. After rollout, rerun both strict Supabase advisors and the
production smoke checks; retained findings still require review.

```bash
# 1. Run the blocking launch gate
pnpm lint
pnpm typecheck
pnpm test
pnpm preflight
pnpm secret-scan
pnpm security:audit
pnpm licenses:check
pnpm build
pnpm test:e2e --project=chromium

# 2. Run the deep lane when the change set warrants it
pnpm test:coverage:core
pnpm test:e2e

# 3. Run production-only validation
pnpm validate:launch-env --mode=production
pnpm preflight:prod

# 4. Build the OpenNext Cloudflare bundle in a supported environment
# Native Windows is not authoritative for this step. Use Ubuntu WSL on ext4,
# Linux, macOS, or CI.
pnpm run build:cloudflare

# 5. Deploy the main OpenNext worker and auxiliary workers
pnpm exec opennextjs-cloudflare deploy
pnpm exec wrangler deploy --config wrangler.rate-limiter.toml
pnpm exec wrangler deploy --config wrangler.retention-cleanup.toml
```

### Staging copy

A separate copy for rehearsals (roadmap M0.15b). Nothing in it is shared with
production:

| Part                | Staging                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| Website             | Worker `verifymzansi-staging`, https://verifymzansi-staging.verifymzansi.workers.dev  |
| Database            | Supabase project `verifymzansi-staging` (`vgplszqfcmdskwseoyam`, London, Free)        |
| Storage             | R2 `verifymzansi-public-staging`, `verifymzansi-private-staging`                      |
| Rate-limit state    | KV `verifymzansi-otp-rate-limits-staging`; Worker `verifymzansi-rate-limiter-staging` |
| PDF and share cards | Worker `verifymzansi-offload-staging`                                                 |
| Durable Objects     | Belong to the staging Worker names, so never production's                             |

Left out on purpose: payments (no Ozow settings exist for staging, so checkout
cannot start), phone codes (no SMS; Africa's Talking sandbox only), and
Cloudflare Images (its free monthly allowance is shared with production, so
staging refuses photo uploads). Every staging response carries
`X-Robots-Tag: noindex` and its `robots.txt` disallows everything; files served
straight from the static assets (scripts, styles) do not pass through the
Worker. To keep strangers out entirely, the owner can put the staging address
behind Cloudflare Access (Zero Trust, free for up to 50 users); the smoke test
would then need an Access service token.

**Release order.** The Deploy workflow deploys every main commit to staging
first (job `deploy-staging`), confirms the staging Worker serves that commit,
runs `e2e/foundation/fixture-smoke.spec.ts` against it
(`playwright.staging.config.ts`), and only then deploys production. A failed
staging deploy or smoke test stops the release. The job `staging-config` decides
first:

- None of the 15 `STAGING_*` secrets set: "Staging skipped", production deploys
  as before.
- Some but not all set (`STAGING_CLOUDFLARE_API_TOKEN` included): the release
  fails until they are complete.
- The staging project does not answer (paused or unreachable), or
  `STAGING_FOUNDATION_SUPABASE_SECRET_KEY` is not a key of the staging project:
  the release fails before anything deploys.

`pnpm cloudflare:staging:isolation -- --require-staging` runs in CI and before
every staging deploy. It reads the staging settings both as written and as
wrangler resolves them, and refuses any production identifier, any route or
custom domain (inherited ones included), inherited cron triggers or shared
bindings, and any wrangler warning about the staging environment. A wrangler
upgrade that adds a new warning therefore fails this check on purpose: read the
warning, fix the staging settings or, if it is harmless, allow that exact
message in `scripts/check-staging-isolation.mjs` with a reason.

**Rehearse once first.** Before staging gates production, run Actions → Deploy →
Run workflow with target `staging`: it deploys and smoke-tests staging only and
never touches production.

**Releasing without staging (owner bypass).** Do not delete staging secrets. Set
the repository Actions variable `STAGING_BYPASS_UNTIL` (Settings → Secrets and
variables → Actions → Variables; only admins can change it) to a UTC time at
most 72 hours ahead, written exactly as `YYYY-MM-DDTHH:MMZ` or
`YYYY-MM-DDTHH:MM:SSZ`, for example `2026-11-20T18:00Z`. Until then every
release skips staging with a loud warning in the run and its summary. Any other
form ("tomorrow", "+48 hours", a time zone offset), an expired time or a time
more than 72 hours ahead is ignored with a warning. Remove the variable
afterwards.

**Do not add a protection rule** (required reviewers or a wait timer) to the
GitHub environment `staging`: both staging jobs use it, so every release would
wait for that approval. Limiting its deployment branches to `main` is fine.

**Keeping the project awake.** Free projects pause after a week without use; a
paused staging project stops the release. The workflow `Staging keep-alive`
reads the staging project anonymously once a day, but only after the owner sets
the admin-only repository variable `STAGING_ENABLED` to `true` (do that once
staging is configured, so an unfinished copy opens no daily failure issues). If
it reports "paused", restore the project in the Supabase dashboard (or use the
bypass above).

**Database.** Staging was built from `database/foundation/` (`candidate.sql`,
`replay/baseline-supplement.sql` before
`20261103154538_owner_signup_access.sql`, then every applied update in filename
order). `fingerprint.sql` on staging matches production's recorded fingerprint,
except `schema_grants` (7 instead of 8 until the Auth "Before user created" hook
is switched on in the staging dashboard). New updates reach staging before merge
(see `database/foundation/updates/README.md`).

**Secrets the owner sets.** Every staging secret lives in one place, the GitHub
environment `staging` (Settings → Environments → `staging`, deployment branches
limited to `main`), and the deploy sends them to the staging Workers. Never copy
a production value; every one is new.

| Environment secret                                         | Value                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGING_CLOUDFLARE_API_TOKEN`                             | A new Cloudflare API token for this account: Account → Workers Scripts Edit, plus only what the deploy needs (Account → Workers KV Storage Read, Account Settings Read). **No** Zone, Workers Routes or DNS permissions, so it can never move a domain. The staging deploy never uses the production deploy token |
| `STAGING_FOUNDATION_SUPABASE_SECRET_KEY`                   | Staging Supabase project → Project Settings → API Keys → new secret key (`sb_secret_…`)                                                                                                                                                                                                                           |
| `STAGING_FOUNDATION_PHONE_OTP_KEY`                         | New random 64 hex characters¹                                                                                                                                                                                                                                                                                     |
| `STAGING_KYC_ENCRYPTION_KEY`                               | New random 64 hex characters¹                                                                                                                                                                                                                                                                                     |
| `STAGING_ID_ENCRYPTION_KEY`                                | New random 64 hex characters¹                                                                                                                                                                                                                                                                                     |
| `STAGING_HMAC_SECRET`                                      | New random 64 hex characters¹                                                                                                                                                                                                                                                                                     |
| `STAGING_IP_HASH_SECRET`                                   | New random 64 hex characters¹                                                                                                                                                                                                                                                                                     |
| `STAGING_INTERNAL_JOBS_SECRET`                             | New random 64 hex characters¹                                                                                                                                                                                                                                                                                     |
| `STAGING_OPS_JOBS_SECRET`                                  | New random 64 hex characters¹                                                                                                                                                                                                                                                                                     |
| `STAGING_HEALTH_DIAGNOSTIC_TOKEN`                          | New random 64 hex characters¹                                                                                                                                                                                                                                                                                     |
| `STAGING_RATE_LIMITER_API_KEY`                             | New random 64 hex characters¹ (also given to the staging rate limiter)                                                                                                                                                                                                                                            |
| `STAGING_RESEND_API_KEY`                                   | A separate Resend API key named for staging, sending access only (`re_…`)                                                                                                                                                                                                                                         |
| `STAGING_AFRICASTALKING_API_KEY`                           | The API key of the Africa's Talking sandbox app (username `sandbox` is set in `wrangler.toml`; no real SMS)                                                                                                                                                                                                       |
| `STAGING_R2_ACCESS_KEY_ID`, `STAGING_R2_SECRET_ACCESS_KEY` | R2 → Manage API tokens → token with Object Read & Write on the two `-staging` buckets only                                                                                                                                                                                                                        |

¹ `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Turnstile on staging uses Cloudflare's published always-pass test keys; nothing
to set.

**Staging dashboard settings.** In the staging Supabase project: Data API
exposed schemas `api` only (the smoke test expects the `public` schema to be
refused); Auth site URL and redirect URLs on the staging address; Auth bot
protection with Turnstile and Cloudflare's published test secret; the "Before
user created" hook on `internal.acceptance_signup_guard`. Optionally attach the
custom domain `media-staging.verifymzansi.com` to `verifymzansi-public-staging`.

### Current Known-Good Runtime Baseline

- Current validated rollback baseline: `next@16.1.5`, `@next/env@16.1.5`, and
  `eslint-config-next@16.1.5` with `@opennextjs/cloudflare@1.17.1`.
- The current request gate remains `src/middleware.ts` delegating to
  `src/proxy-handler.ts`.
- `pnpm run build:cloudflare` passed for this baseline from the Ubuntu WSL ext4
  workspace and generated `.open-next/worker.js` successfully.
- The Next.js `middleware` deprecation warning is still expected on this line,
  but it does not block OpenNext bundling.

### Rollback on Failure

The Deploy workflow does **not** roll back automatically. Rolling back only the
main Worker left production half old and half new twice in October 2026, once on
a build made for the retired backend. When any production step fails or the run
is cancelled after the deploy has started (helper Worker deploys, the health
check), the step "Stop for manual rollback" fails the run with the error "Manual
rollback needed". The site keeps whatever versions are live until a person acts.
A run that timed out or lost its runner after "Deploy authenticated service
monitor" started needs the same procedure, even without that message.

### Manual rollback (all Workers)

Roll every Worker back to the same last good release, never only the main one.
`wrangler rollback` needs no build, so it also works from Windows (run the
commands in Git Bash, or use the PowerShell equivalents noted).

0. **Stop new deploys first.** Actions → Deploy → "…" → Disable workflow (or
   `gh workflow disable deploy.yml`). Otherwise the next green CI run on `main`,
   or a queued run, deploys over a half-finished rollback. Check Actions for a
   newer Deploy run: if one already fixed forward, do not roll back to an older
   release. Re-enable the workflow only after step 6.
1. **Pick the last good release and its version IDs.** Actions → Deploy: the
   newest successful run before the failed one. A run whose only failed step is
   "Recheck live project security settings" deployed its code completely: it
   counts as good here (that step reports a dashboard setting to fix, not a bad
   release). Its log prints one `Current Version ID:` line per Worker; those IDs
   are the targets. For the main Worker, the target version's message is
   `verified-main-deployment` (inactive `inactive-main-candidate` uploads carry
   the same commit tag and are never a target). `wrangler versions list` shows
   only the 10 newest versions; use the Cloudflare dashboard (Worker →
   Deployments) for older ones.
2. **Check it is a foundation build.**
   `git show <sha>:wrangler.toml | grep NEXT_PUBLIC_DATA_BACKEND` (PowerShell:
   `git show <sha>:wrangler.toml | Select-String NEXT_PUBLIC_DATA_BACKEND`) must
   print `foundation` or nothing (builds after the retired backend was removed
   no longer set it; they cannot run the retired backend at all);
   `pnpm exec wrangler versions view <version-id> --env production` shows the
   version's own variables. Never roll back to a build made for the retired
   source backend.
3. **Check the database.** A Worker rollback does not undo database updates.
   `git diff <good-sha>..<bad-sha> -- database/` lists the updates in between.
   Older code works with updates that only added pieces; never roll back past an
   update that removed or renamed something the older code uses (see "Database
   changes" in [AGENTS.md](../AGENTS.md)). If unsure, stop and ask.
4. **Check secrets and schedules.** If `wrangler rollback` lists secrets that
   changed since the target version, confirming restores their old values. Stop
   unless those old values are still valid (a rotated and revoked key would
   break the site), or put the current secrets back right after the rollback.
   Cron schedules and routes are not part of a version:
   `git diff <good-sha>..<bad-sha> -- 'wrangler*.toml'` shows whether they
   changed. Durable Object and KV data is never rolled back.
5. **Roll back each Worker.** First run `deployments list` for every Worker and
   skip only a Worker that already shows its target version ID. For the rest:

   | Worker                   | Current deployment                                                             | Roll back                                                                                                                |
   | ------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
   | `verifymzansi` (website) | `pnpm exec wrangler deployments list --env production`                         | `pnpm exec wrangler rollback <version-id> --env production --message "Manual rollback to <sha>"`                         |
   | site monitor             | `pnpm exec wrangler deployments list --config wrangler.site-monitor.toml`      | `pnpm exec wrangler rollback <version-id> --config wrangler.site-monitor.toml --message "Manual rollback to <sha>"`      |
   | rate limiter             | `pnpm exec wrangler deployments list --config wrangler.rate-limiter.toml`      | `pnpm exec wrangler rollback <version-id> --config wrangler.rate-limiter.toml --message "Manual rollback to <sha>"`      |
   | retention clean-up       | `pnpm exec wrangler deployments list --config wrangler.retention-cleanup.toml` | `pnpm exec wrangler rollback <version-id> --config wrangler.retention-cleanup.toml --message "Manual rollback to <sha>"` |
   | payment clean-up         | `pnpm exec wrangler deployments list --config wrangler.payment-cleanup.toml`   | `pnpm exec wrangler rollback <version-id> --config wrangler.payment-cleanup.toml --message "Manual rollback to <sha>"`   |
   | operations jobs          | `pnpm exec wrangler deployments list --config wrangler.ops-jobs.toml`          | `pnpm exec wrangler rollback <version-id> --config wrangler.ops-jobs.toml --message "Manual rollback to <sha>"`          |

6. **Confirm and clean up.** `deployments list` shows every target version;
   `/api/health` answers `ok`; the site monitor is green. Revert the bad pull
   request on GitHub. When the revert's CI on `main` is green, re-enable the
   Deploy workflow and run it by hand (Actions → Deploy → Run workflow) so
   production matches `main` again.

### Worker Deployment

Application deployment uses the provisioned-runtime preflight for the existing
London database. The draft clean-database installer remains guarded separately;
app deployment does not run its migrations or declare full feature acceptance.
CI, environment validation, workerd startup and post-deployment readiness remain
required.

`verifymzansi-site-monitor` authenticates CI with its dedicated monitor secret
and runs the shared anonymous smoke scenarios plus deep readiness through an app
service binding. It forwards no caller cookies or authentication to the app.
Public-edge delivery is checked separately. A specifically identified Cloudflare
automation challenge is reported as **inconclusive** (a warning and a line in
the run summary), never as a pass, and it cannot make a failed service smoke or
readiness check pass. A regular 403/503 remains a failure.

The foundation payment, retention and operations workers call the main
`verifymzansi` Worker through the `APP` service binding. The internal requests
retain their scoped credentials and redirect refusal without traversing public
website bot challenges. `WORKER_API_KEY` on payment/retention matches the app's
`INTERNAL_JOBS_SECRET`; operations uses the shared `OPS_JOBS_SECRET`.

After editing companion configuration, run `pnpm cloudflare:types:companions`,
then `pnpm cloudflare:types:companions:check` and
`pnpm test:cloudflare:companions`. The latter executes all three scheduled
handlers in isolated workerd with a local app fixture and synthetic credentials.
Worker health URLs prove process liveness only; app deep readiness, failed-run
records and heartbeats establish job health (see
[Monitoring and Alerts](#monitoring-and-alerts)).

```bash
# Deploy individual workers
pnpm exec wrangler deploy --config wrangler.rate-limiter.toml
pnpm exec wrangler deploy --config wrangler.retention-cleanup.toml
pnpm exec wrangler deploy --config wrangler.payment-cleanup.toml
pnpm exec wrangler deploy --config wrangler.ops-jobs.toml

# Check worker health
curl https://verifymzansi-rate-limiter.verifymzansi.workers.dev/
curl https://verifymzansi-retention-cleanup.verifymzansi.workers.dev/
curl https://verifymzansi-payment-cleanup.verifymzansi.workers.dev/
```

### Production Pre-Deploy Checklist

- [ ] Use Ubuntu WSL on ext4, Linux, macOS, or CI for
      `pnpm run build:cloudflare`
- [ ] `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set for
      the production client bundle
- [ ] `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are reviewed
- [ ] `ENABLE_DEV_PAYMENT_BYPASS` is NOT set
- [ ] `DEV_EXPOSE_OTP` is NOT set
- [ ] All secrets rotated from test/dev values
- [ ] `pnpm preflight:prod` passes
- [ ] Blocking launch gate passes
- [ ] Required deep-lane checks pass for the release candidate
- [ ] `pnpm run build:cloudflare` passes in a supported environment
- [ ] Post-deploy verify `/api/health`, `/`, `/login`, and a previously failing
      route before declaring the release healthy

---

## Database Backups

`.github/workflows/database-backup.yml` runs twice a day (scheduled for 22:47
and 10:47 SAST; GitHub usually starts it 3 to 5.5 hours later), and can be
started by hand from the Actions tab. Two runs keep the gap between stored
backups near 12 to 14.5 hours, inside the 24-hour recovery point; a single
failed run leaves a gap of about 24 to 26.5 hours instead of two days. It dumps
roles, schema and data with the Supabase CLI, checks the dump, encrypts it to
`.github/backup/database-backup-public-key.asc` and stores it in the private R2
bucket `verifymzansi-backups` under `database/YYYY/MM/DD/`. R2 deletes copies
after 35 days.

Each encrypted archive holds:

- `roles.sql`, `schema.sql`, `data.sql`: the application schemas (`api`,
  `private`, `internal`, `public`, `auth`, `extensions`).
- `platform-schema.sql`: the Supabase-managed `realtime` and
  `supabase_migrations` schemas, including the `owner_inbox_receive` policy on
  `realtime.messages`. `platform-data.sql`: the hosted migration ledger
  (`supabase_migrations.schema_migrations`). Realtime rows are transient and not
  kept; `storage` and `vault` are not used by the app and not dumped.
- `ROW-COUNTS.tsv`: the exact row count of every table whose data is dumped (the
  schemas above plus `supabase_migrations`), read from the live database just
  after the dump (`live_rows`) and counted from the dump itself (`dump_rows`).
  They can differ by rows written during the dump; `not_in_dump` marks tables
  the CLI leaves out (such as `auth.schema_migrations`). In `api`, `private`,
  `internal` and `public`, a table that is unreadable, not in the dump, or has
  more live rows than dumped (an empty dump included) beyond 50 rows or 1%
  (whichever is larger) is recorded as a problem, so a queue that fills just
  after the snapshot is not a false alarm.
- `FINGERPRINT.tsv`: `database/foundation/fingerprint.sql` run read-only on
  production, comparable with `fingerprint.json` `productionCheck`.
- `MANIFEST.txt`: dump start and end times, CLI and psql versions, the commit,
  any part that could not be captured (`problem:` lines) and the sha256 of every
  file. The queries are in `.github/backup/backup-manifest.sql`; the job log
  shows only totals, sizes and the fingerprint hashes.

If the platform schemas, row counts or fingerprint cannot be captured (each is
capped by a timeout: 5 minutes per platform dump, 7 minutes for the counts), or
the plaintext cannot be shredded, the run still stores the main backup and then
fails, so the failure alert fires.

- **Credentials** (GitHub environment `backup`, deployment branch `main`):
  - `SUPABASE_BACKUP_DB_PASSWORD`: the database password (Supabase > Project
    Settings > Database). Reset it there if a run reports an authentication
    failure, then update the secret. The connection string is built from it in
    one step and kept in a private file that only the dump and count steps read.
  - `BACKUP_R2_ACCESS_KEY_ID` and `BACKUP_R2_SECRET_ACCESS_KEY`: an R2 API token
    with Object Read & Write limited to the `verifymzansi-backups` bucket, so a
    leaked backup token cannot touch member media or ID evidence. The backup and
    the freshness check both use it.
  - `R2_ACCOUNT_ID`.
  - Transitional only: until the bucket token exists, both jobs use the app's
    storage key (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, repository level)
    and warn on every run. Create the bucket token before moving the app's
    storage key into the `production` environment, which these jobs cannot read.
- **Decryption key:** only the owner holds the private key, offline (key
  fingerprint `CBADD845A4EEE95E8ADD376D8DD25F76A198D659`). Without it no backup
  can be restored. Never commit it or store it in GitHub, Cloudflare or
  Supabase.
- **Failure alerts:** GitHub emails the owner when a scheduled run fails, and
  the Failure alert workflow opens an issue.
  `.github/workflows/backup-freshness.yml` runs every 6 hours and fails (opening
  the same issue) when the newest object under `database/` in the bucket is 27
  hours old or older (two runs in a row stored nothing; one missed run leaves at
  most about 26.5 hours) or dated more than 5 minutes in the future, or when the
  latest commit is 45 days old or older. It lists the bucket with the backup
  job's credentials (above). GitHub pauses schedules in public repositories
  after 60 days without commits, the freshness check included; merge a change
  before then, or re-enable the workflows if that happens. A paused run sends no
  email, so the optional `HEARTBEAT_URL_DATABASE_BACKUP` heartbeat (see
  [Monitoring and Alerts](#monitoring-and-alerts)) is what catches backups that
  silently stop once schedules are paused.

### Restoring

1. Download the newest `.tar.gz.gpg` from the R2 bucket (Cloudflare dashboard >
   R2 > `verifymzansi-backups`).
2. Import the private key once, then decrypt and unpack:

   ```bash
   gpg --import verifymzansi-database-backup-PRIVATE-key.asc
   gpg --output backup.tar.gz --decrypt verifymzansi-db-<timestamp>.tar.gz.gpg
   tar -xzf backup.tar.gz
   sha256sum -c MANIFEST.txt --ignore-missing
   ```

3. Restore into an empty Supabase project, never on top of live data:

   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "$TARGET_DB_URL"
   ```

   The new project already has its own `realtime` and `supabase_migrations`
   tables, so do not replay `platform-schema.sql` whole: run only its
   `CREATE POLICY "owner_inbox_receive" ON "realtime"."messages"` statement
   (after the foundation functions exist), and load `platform-data.sql` only if
   the migration history should be carried over.

4. Prove completeness: `select count(*)` on each table should equal the
   `dump_rows` column of `ROW-COUNTS.tsv`, and
   `database/foundation/fingerprint.sql`, run after
   `set search_path to "$user", public;`, should return the rows in
   `FINGERPRINT.tsv`.

5. Point the app at the restored project only after checking accounts, posts and
   payments. Uploaded media and ID documents live in R2 and are not part of this
   backup.

---

## Monitoring and Alerts

The goal is that a broken site or a stopped timed job reaches a person within
minutes. The code side is in place; the accounts, phone numbers and URLs that
turn it into alerts are owner steps, listed below. Nothing here is configured
until the owner does those steps.

### What the code does

- **Failure alert** (`.github/workflows/failure-alert.yml`) opens one issue
  titled "Automated alert: a main or scheduled workflow run failed", or comments
  on it while it is open, when a run on main or a scheduled run fails, times out
  or cannot start, when a scheduled run is cancelled, and when a Deploy is
  cancelled after its last "main has not moved" check (production may then be
  half old and half new). The issue is assigned to the repository owner, so
  GitHub emails each comment to them as a "participating" notification (in
  GitHub > Settings > Notifications > Participating, keep Email ticked); if the
  assignment fails, the alert run itself fails. Each workflow comments at most
  every 6 hours. Close the issue once the cause is fixed.
- **Main deployed** (`.github/workflows/main-deployed.yml`, hourly) fails when
  the newest commit on main has not been deployed for 3 hours (CI plus Deploy
  normally take under an hour). A deploy that stops at "Reject stale deployment
  sources" or "Recheck main immediately before production changes" because main
  moved on raises no alert of its own, nor does one cancelled before that check,
  since the deploy of the newer main follows; this check is the safety net if it
  does not. A cancelled Deploy run never counts as live.
- **Synthetic Monitoring** (`.github/workflows/synthetic-monitoring.yml`, asked
  for twice an hour; GitHub actually starts it about 4 times a day, sometimes 9
  hours apart) checks the public homepage and the authenticated site monitor. A
  missing setting fails the run; there are no skip-and-pass steps. A Cloudflare
  challenge on the public check is reported as inconclusive, not as a pass.
  Cloudflare's error page on a 503 counts as a failure. Inconclusive runs send
  no email, so if every run is inconclusive the public homepage goes unchecked
  from GitHub; the external public homepage check (owner step 1) covers that.
  GitHub emails one account when a scheduled run fails, and schedules can be
  delayed or paused, so this is a backstop rather than the main alert.
- **Timed Workers** (`verifymzansi-ops-jobs` every minute,
  `verifymzansi-payment-cleanup` every 10 minutes,
  `verifymzansi-retention-cleanup` every 5 minutes): when the app cannot finish
  a run, the scheduled handler fails, so Cloudflare records the run as failed in
  the Worker's logs instead of logging an error and reporting success. After a
  successful scheduled run each Worker pings its own optional heartbeat URL.
  Authenticated manual runs do not ping, so a heartbeat means the schedule
  itself is firing.
- **Database backup** pings its optional heartbeat URL only after the encrypted
  backup is uploaded and its size checked.
- A heartbeat is a plain HTTPS GET with no credentials and a short timeout. An
  unset URL sends nothing; a failed ping logs only the job name and never fails
  the job. The URL itself is treated as a secret and is never logged.
- **Operations jobs run each step on its own.** The timed sweeps and the email
  batch run side by side; a sweep that fails does not stop the other sweeps or
  the emails. When any step failed, the run is reported as failed after every
  other step has finished, and the app Worker log line
  `Operation job run failed` names the failed steps (for example
  `sweep:sweep_sponsorships`, `claim:payment`, `privacy_notice`, `staff_alert`).
- **Queued emails** go out up to 25 a run: payment messages first, then
  privacy-request notices (up to five), then every other kind. Every claim uses
  up one of a message's eight attempts, so messages are claimed one at a time,
  only while a worst-case send still fits, and each is sent straight away; the
  next claim runs while the previous outcome is recorded, except near the end of
  the send window, where a slow record could otherwise push it past the window.
  Sends are paced to the email provider's rate. The worker gives the request 50
  seconds from its own start (including dispatch and start-up), so the run aims
  to end within 44 seconds: database calls are cut off then, and no claim or
  send (including the staff alert) starts after 13 seconds. Even a send that
  uses all its provider retries, and the record of its outcome, then end in
  time.
- **Unknown outcome.** When the provider refuses a repeat of an earlier request
  with the same key (still in progress, or sent with different content), the
  earlier request may have been delivered. The message is recorded with the
  error `outcome_unknown` and retried later; on its last attempt it is logged
  (`Queued email outcome unknown at its last attempt`) and listed in the staff
  alert marked "may have been delivered".
- **Last attempt.** A queued email is tried at most eight times. When one fails
  on its eighth attempt, the run logs `Queued email reached its last attempt`
  (kind and queue id only) straight away and, before any further send, emails
  the support address. Later losses in the same run are collected into one more
  alert at the end of the email batch (or when the send window is nearly over):
  at most two alerts a run. A lost email that no alert covers, or an alert that
  cannot be sent, fails the run (`staff_alert`). The alert is not retried, and
  with a one-minute job and a five-minute heartbeat grace, one failed run does
  not page anyone.
- **Where lost emails stay.** The database never hands such an email out again
  and never purges it (only delivered emails are deleted, 30 days after
  delivery), so it stays in `private.outbox_events`. The owner can list them
  read-only in the Supabase SQL editor for the London project:

  ```sql
  select id, kind, created_at, delivery_attempts, delivery_error
  from private.outbox_events
  where processed_at is null and delivery_attempts >= 8
  order by created_at;
  ```

  `delivery_error` is `delivery_failed`, `deferred` or `outcome_unknown`. There
  is no retry button yet; tell the account owner directly if the email mattered.
  Run this query too whenever a run fails with a `claim:payment` or
  `claim:other` step: a claim that was cut off or lost on the way back can use
  up an email's last attempt without the app seeing the email, so no alert names
  it.

- Known gap: an email that fails an earlier attempt is retried later and does
  not fail the run, and a storage object that could not be deleted yet does not
  either, so a lasting email outage shows only through the last-attempt alert
  (about two hours after the first failure), which itself goes through the same
  email provider. Privacy-request notices that use up their attempts raise no
  alert yet. Payment checks with failures do fail the run.

### Payment alerts

Payment problems are logged, kept in the database and emailed to staff (database
update `20261112080000_payment_problem_alerts.sql`; see
`database/foundation/updates/README.md`).

- **What counts as a problem.** A correctly signed Ozow notice that can never be
  applied (wrong amount, currency, site, test flag, payment request or
  transaction; no payment for its reference; unreadable), a transaction the
  10-minute status check refuses for the same reasons, two successful
  transactions on one payment request, and settlement outcomes that need a
  person (a second successful payment, one bank transaction used for two
  payments, money received for a plan or add-on that could not be activated,
  money returned at the bank after activation). Nothing about the payment
  changes: no plan is removed, no refund is made.
- **Log lines** (app Worker logs, no member details): every problem is logged as
  `Payment problem` with `paymentId` (null when no payment matched), `reason` (a
  code such as `amount_mismatch`, `multiple_settlements` or
  `complete_unfulfillable_target`) and `source` (`notice` or `status_check`),
  plus `anomaly` (`wrong_amount`, `paid_twice`, `not_activated` or `refunded`)
  when staff are emailed at once. A wrong amount or a second transaction is
  emailed only when the bank reports it successful (money moved); otherwise it
  is in the daily summary only. Every failed status check is logged as
  `Payment status check failed` with `paymentId` and `reason` (a problem code,
  or `provider_unavailable`, `database_unavailable`, `network_error` and similar
  for outages), and the status-check job's reply lists them in `errors`.
  `Payment problem could not be recorded` means the database refused, was
  unavailable or did not answer within three seconds; the log line is then the
  only record.
- **Email at once.** The email job (every minute), after the members' payment
  messages, sends one email listing every problem with an `anomaly` not emailed
  yet: payment number, Ozow reference, amount, payment state, how it was found
  and when it was flagged. A failed send fails that run (`payment_alert`) and is
  tried again, as the same email, five minutes later. A problem emailed before
  is emailed again when another bank transaction shows it (for example a third
  successful payment), at most five times. A flagged problem that could not be
  emailed within 7 days (for example while `PAYMENT_ALERT_EMAILS` was unset) is
  not emailed any more: find it with the query below. There is no
  acknowledgement yet; that comes with the staff payment tools.
- **Daily summary.** The first email job run after 07:00 South African time
  sends a summary of the problems seen since the previous summary, the payments
  still waiting for staff (paid but not activated; pending with an Ozow request
  for over 2 hours), problems flagged in the last 7 days and not emailed yet,
  and the count of each kind of payment notice and status check. It is sent
  every day, also when there is nothing to report, which shows the alert path
  still works. A retry after a failed send repeats the same summary.
- **Recipients.** `PAYMENT_ALERT_EMAILS`, one to three addresses separated by
  commas (the owner first; one or two trusted people later). Everyone listed
  sees the other addresses. The setting is read only when there is something to
  send. If it is not set, or not one to three valid addresses, nothing is
  emailed: while an alert waits, every email job run logs
  `Payment alert not emailed: no recipients configured` (with the payment
  numbers and reasons) and fails with `payment_alert:recipients`, so the
  operations heartbeat stops and its monitor alerts you; once a day the summary
  is logged instead
  (`Daily payment summary not emailed: no recipients configured`, with the day's
  counts) and that run fails with `payment_summary:recipients`. Payments and
  every other email keep working.
- **Reading the record.** In the Supabase SQL editor for the London project
  (read only):

  ```sql
  select payment_id, reason, source, needs_alert, alert_raised_at,
    alerted_at is not null as emailed, occurrences, first_seen_at, last_seen_at
  from private.payment_problems
  order by last_seen_at desc
  limit 50;
  ```

### Owner steps (not done in code)

1. **External uptime monitor on the authenticated site monitor.** In a
   monitoring service that can send a request header and keep it secret, add a
   check of `GET https://verifymzansi-site-monitor.verifymzansi.workers.dev/`
   with the header `Authorization: Bearer <SITE_MONITOR_API_KEY value>`. Alert
   when the answer is not HTTP 200 or the JSON `status` is not `ok`, after two
   failed checks in a row, checking every 1 to 5 minutes. The key only runs the
   fixed anonymous smoke checks; if it is ever rotated, update the GitHub
   secret, the Worker secret `MONITOR_API_KEY` and this monitor together. In the
   same service add a plain check of `https://verifymzansi.com/` that alerts
   when the page does not load, so the public edge is watched from outside
   GitHub too.
2. **One heartbeat check per timed job** in a heartbeat ("dead man's switch")
   monitor that accepts an HTTPS GET. Store each URL only as a secret, never in
   a `wrangler.*.toml` `[vars]` block or in the repository:

   | Job               | Secret name                       | Where it is set                                           | Runs every | Suggested grace |
   | ----------------- | --------------------------------- | --------------------------------------------------------- | ---------- | --------------- |
   | Operations jobs   | `HEARTBEAT_URL_OPS_JOBS`          | Worker secret, `--config wrangler.ops-jobs.toml`          | 1 minute   | 5 minutes       |
   | Payment check     | `HEARTBEAT_URL_PAYMENT_CLEANUP`   | Worker secret, `--config wrangler.payment-cleanup.toml`   | 10 minutes | 30 minutes      |
   | Retention cleanup | `HEARTBEAT_URL_RETENTION_CLEANUP` | Worker secret, `--config wrangler.retention-cleanup.toml` | 5 minutes  | 20 minutes      |
   | Database backup   | `HEARTBEAT_URL_DATABASE_BACKUP`   | GitHub repository secret                                  | daily      | 6 hours         |

   Set a Worker secret with
   `pnpm exec wrangler secret put HEARTBEAT_URL_OPS_JOBS --config wrangler.ops-jobs.toml`
   (and likewise for the others). GitHub starts scheduled runs late, recently by
   three to four hours, hence the long backup grace. Deploys keep Worker secrets
   that are not in the deploy's secrets file. The Worker code that reads these
   must already be deployed; until a URL is set no heartbeat is sent.

3. **A second person.** Add a second person's phone (app push or SMS) to both
   monitors' alert contacts, so one unavailable person does not mean no
   response. GitHub's failed-run email reaches only one account.
4. **Error reporting.** Sentry event delivery needs `NEXT_PUBLIC_SENTRY_DSN`
   (see [Sentry Bug Finding](#sentry-bug-finding)); it is a separate owner step.
5. **Payment alert addresses.** Set the app Worker secret `PAYMENT_ALERT_EMAILS`
   to the addresses that should receive payment alerts and the daily payment
   summary (one to three, separated by commas):
   `pnpm exec wrangler secret put PAYMENT_ALERT_EMAILS --env production`.
   Deploys keep it (it is not in the deploy's secrets file). Apply the database
   update `20261112080000_payment_problem_alerts.sql` and set this secret before
   the release that uses them is deployed. To check the address works, look for
   the next morning's daily summary.

### When an alert arrives

- **Site monitor down:** follow [Service Down](#service-down). The JSON answer
  lists which smoke check failed.
- **Heartbeat missing:** open the Worker in the Cloudflare dashboard (Workers &
  Pages, the Worker, Logs) and look for failed scheduled runs and their error
  message (`App job returned HTTP <status>`, `App job request failed` or
  `Invalid job configuration`). Then check the app Worker's logs for the
  matching route. For the backup, open the failed Database Backup run in GitHub
  Actions.
- **Last-attempt email alert:** check the email provider's status page and
  sending limits, then the app Worker logs for
  `Queued email reached its last attempt`, and list every such email with the
  read-only query under "Where lost emails stay". Those emails are not retried
  automatically; tell the affected account owners if the message mattered
  (payment messages first).
- **Payment alert:** look the payment up in Ozow's merchant portal by the Ozow
  reference in the email, and in the staff payments list by its payment number.
  Wrong amount: the payment was not settled; confirm with Ozow what was paid.
  Paid twice: one payment was settled (or, from the status check, none); return
  the extra payment at Ozow and record the refund. Paid but not activated: the
  money was received and the plan or add-on was not given; contact the member,
  then activate it or refund. Money returned after activation: the plan is still
  active; decide whether to end it. The app Worker logs hold the same payment
  number under `Payment problem`.

---

## Sentry Bug Finding

Use [playbooks/sentry-bug-finding.md](playbooks/sentry-bug-finding.md) for the
two-lane Sentry workflow:

- live triage against unresolved production issues and recent events
- local route-by-route debugging with the Sentry Toolbar

The runbook standardizes these operator inputs:

- `NEXT_PUBLIC_SENTRY_DSN` for SDK event delivery
- `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` for CLI/API reads and
  release or source-map validation

Use it when you need to turn a Sentry issue into a concrete repo repro target
before changing code.

---

## KYC Provider Management

### Current Setup

VerifyMzansi launches with `KYC_PROVIDER=stub`, meaning all KYC verifications
are processed via **manual admin review** only. This is an intentional launch
decision.

### Adding a New KYC Provider

1. Create a new provider module in `src/lib/services/`:

   ```typescript
   // src/lib/services/kyc-provider-<name>.ts
   export async function verifyIdentity(
     data: KycSubmission
   ): Promise<KycResult> {
     // Call external KYC API
     // Return standardized result
   }
   ```

2. Update `src/lib/services/kyc-provider.ts`:

   ```typescript
   const provider = process.env.KYC_PROVIDER ?? "stub";

   switch (provider) {
     case "stub":
       return stubProvider;
     case "<new-provider>":
       return newProvider;
     default:
       throw new Error(`Unknown KYC provider: ${provider}`);
   }
   ```

3. Set `KYC_PROVIDER=<new-provider>` in environment variables
4. Add provider API keys as production secrets (see Secret Rotation)
5. Update the KYC engine to handle automated results alongside manual review
6. Test thoroughly in staging before enabling in production

### Monitoring KYC Queue

```sql
-- Pending manual reviews
SELECT COUNT(*) FROM verification_sessions WHERE status = 'pending_review';

-- Average review time
SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) / 3600 AS avg_hours
FROM verification_sessions
WHERE status IN ('approved', 'rejected')
AND updated_at > NOW() - INTERVAL '7 days';
```

---

## Incident Response

### Service Down

1. Check Cloudflare status:
   [https://www.cloudflarestatus.com/](https://www.cloudflarestatus.com/)
2. Check Supabase status:
   [https://status.supabase.com/](https://status.supabase.com/)
3. Verify health endpoint: `curl https://verifymzansi.com/api/health`
4. Check deployment logs in Cloudflare Dashboard for the main worker and worker
   versions
5. If recent deploy caused the issue, rollback immediately (see above)

### Data Breach Suspected

1. **Immediately** rotate all encryption keys and API secrets
2. Disable affected accounts via Supabase Auth admin API
3. Check audit logs for unauthorized access
4. Notify affected users within 72 hours (POPIA requirement)
5. File a report with the Information Regulator if personal data was exposed
6. Document the incident and remediation steps

### High Error Rate

1. Check application logs in Cloudflare Dashboard → Workers & Pages →
   verifymzansi → Logs
2. Check Supabase Dashboard → Logs for database errors
3. Review recent deploys for potential regressions
4. Check feature flags — disable any recently enabled flags
5. If persistent and correlated with the Next.js 16.2.0 window, revert to the
   validated `16.1.5` baseline or rollback the current worker version

### Verification Camera Prompt Not Showing

Use this playbook when users report the verification camera fails to open, no
permission prompt appears, or the UI shows camera denied/blocked messages.

1. Reproduce on `/verification` with a test account and confirm route reaches
   Step 2 (ID) or Step 3 (Selfie).
2. Confirm the browser receives `Permissions-Policy` with `camera=(self)` on the
   first app document the user loads, especially
   `/login?returnUrl=/verification`, `/dashboard`, and `/verification`. In-app
   navigation keeps the original document policy, so a stale `camera=()` policy
   can block the prompt after the user reaches verification.
3. Ask user to open in-flow verification help (`/help/verification`) from the
   error panel and reset camera permission in browser/site settings.
4. Verify fallback upload path works immediately for both ID document and selfie
   steps.
5. In Sentry, filter events for `camera_init_failed` and inspect `camera_init`
   context (`errorName`, `permissionState`, `facingMode`, `isSecureContext`,
   `mobile`, `platform`).
6. If many events show `MediaDevicesUnavailable` or `SecurityError`, validate
   users are on modern browsers and secure HTTPS origins only.
7. If many events show `NotReadableError`, advise closing other apps/tabs that
   may lock the camera and retry.
8. If issue persists for multiple users across browsers, run targeted KYC
   verification E2E matrix and escalate as platform incident.

Quick validation commands:

```bash
pnpm test:e2e --project=chromium --project=mobile-chrome e2e/foundation/staff-review.spec.ts
pnpm foundation:e2e:down   # delete the local test copy afterwards
```
