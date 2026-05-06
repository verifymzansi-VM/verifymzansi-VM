# VerifyMzansi — Operations Runbook

> Operational procedures for maintaining and operating the VerifyMzansi
> platform.

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
- [Sentry Bug Finding](#sentry-bug-finding)
- [KYC Provider Management](#kyc-provider-management)
- [Incident Response](#incident-response)

---

## Cloudflare MCP

Use [docs/cloudflare-mcp.md](docs/cloudflare-mcp.md) as the operator guide for
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
main Workers/Pages deployment.

### Cloudflare MCP Token Policy

Use least-privilege Cloudflare credentials for MCP access.

- Start with read-only access for inspection tasks.
- Scope access to the resources this repo actually uses: the `verifymzansi`
  Workers/Pages deployment, the `verifymzansi-public` and `verifymzansi-private`
  R2 buckets, and the KV namespace bound as `OTP_RATE_LIMITS`.
- Add broader permissions only for approved workflows such as observability,
  build inspection, or intentional operational changes.
- If MCP starts on one machine but not another, compare local Cloudflare or
  Wrangler auth state before changing workspace config.

#### Recommended Token Split

Use separate tokens by workflow instead of one catch-all token.

- Baseline read-only token: Worker or Pages read access for `verifymzansi`, R2
  read access for `verifymzansi-public` and `verifymzansi-private`, KV read
  access for `OTP_RATE_LIMITS`, and read access for Worker binding or Durable
  Object inspection.
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

### Supabase Keys

1. Go to Supabase Dashboard → Settings → API
2. Rotate the `service_role` key
3. Update in Cloudflare Pages environment variables:
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Redeploy the application
5. Verify `/api/health` returns 200

> **Note:** The `anon` key is public and does not need rotation unless
> compromised.

### Ozow Credentials

#### OAuth Client Credentials

1. Log in to the Ozow merchant or developer portal
2. Rotate the OAuth client credentials
3. Update in Cloudflare Pages:
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
4. Update `OZOW_WEBHOOK_SECRET` in Cloudflare Pages environment variables:
   ```bash
   npx wrangler pages secret put OZOW_WEBHOOK_SECRET --project-name verifymzansi
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
   - Production: `https://verifymzansi.co.za/api/webhooks/ozow`
2. **Method:** POST
3. **Events to subscribe:** `transaction.complete` (covers successful and failed
   transactions)
4. **Signature format:** Svix — Ozow sends `svix-id`, `svix-timestamp`, and
   `svix-signature` headers
5. **Setup steps:** a. Log in to the Ozow portal → Webhooks section b. Create
   (or update) a webhook subscription pointing to the endpoint URL c. Select the
   `transaction.complete` event type d. Copy the signing secret provided by Ozow
   e. Store the secret as `OZOW_WEBHOOK_SECRET` in Cloudflare Pages secrets f.
   Deploy and verify using the test webhook feature in the portal
6. **Verification checklist:**
   - [ ] Webhook returns HTTP 200 for valid signatures
   - [ ] Webhook returns HTTP 403 for missing or invalid signatures
   - [ ] Payment fulfillment completes (status transitions to `completed`)
   - [ ] Audit log entry is written for the webhook event
   - [ ] Amount and currency match validation passes

### KYC Provider Webhook Secret

1. Rotate the KYC provider webhook signing secret in the provider dashboard.
2. Update `KYC_WEBHOOK_SECRET` in Cloudflare Pages or Worker secrets.
3. Run `pnpm validate:launch-env` and `pnpm preflight:prod` before deploy.
4. Redeploy and verify `/api/webhooks/kyc/provider` rejects unsigned or
   invalidly signed requests.

### R2 (Cloudflare Storage) Keys

1. Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens
2. Create a new token with the same permissions
3. Update in Cloudflare Pages:
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
3. Update `RESEND_API_KEY` in Cloudflare Pages
4. Redeploy and send a test email
5. Revoke the old key

### Africa's Talking (SMS/OTP) API Key

1. Go to Africa's Talking Dashboard → Settings → API Key
2. Generate a new key
3. Update `AFRICASTALKING_API_KEY` in Cloudflare Pages
4. Redeploy and test OTP sending
5. Deactivate the old key

### Cloudflare Turnstile

1. Go to Cloudflare Dashboard → Turnstile
2. Rotate the secret key for your site
3. Update in Cloudflare Pages:
   - `TURNSTILE_SECRET_KEY`
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (if site key changed)
4. Redeploy and verify CAPTCHA works on login/register pages

---

## Feature Flags

### Viewing Current Flags

- Admin Panel: `/admin/feature-flags`
- Database: `SELECT * FROM feature_flags ORDER BY key;`

### Toggling a Flag (Legacy)

```bash
curl -X POST https://verifymzansi.pages.dev/api/admin/feature-flags/toggle \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"key": "kyc_gps_location", "enabled": true}'
```

### Canary Rollout

```bash
# Enable for 10% of users
curl -X POST https://verifymzansi.pages.dev/api/admin/feature-flags/toggle \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"key": "new_checkout", "mode": "percent", "percent": 10, "reason": "Gradual rollout"}'

# Enable for specific roles only
curl -X POST https://verifymzansi.pages.dev/api/admin/feature-flags/toggle \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"key": "admin_v2", "mode": "allowlist", "allowlist_roles": ["admin", "moderator"], "reason": "Staff testing"}'
```

### Emergency Flag Disable

1. Go to Admin Panel → Feature Flags
2. Toggle the flag off
3. Or via API: `{"key": "<flag>", "enabled": false}`
4. All changes are audit-logged

See also:
[Feature Flag Rollback Playbook](docs/playbooks/feature-flag-rollback.md)

---

## DSAR Processing (POPIA)

> South African POPIA law requires responding to Data Subject Access Requests
> within **30 days**.

### Processing a Request

1. Requests arrive via `/dsar` page or email
2. Check the Admin Panel → DSAR queue (or `dsar_requests` table)
3. Verify the requester's identity using their SA ID number (Luhn-validated)
4. Gather all personal data:

   ```sql
   -- User profile
   SELECT * FROM auth.users WHERE id = '<user_id>';
   -- Seller profile
   SELECT * FROM seller_profiles WHERE user_id = '<user_id>';
   -- Verification data
   SELECT * FROM verification_sessions WHERE user_id = '<user_id>';
   -- Listings
   SELECT * FROM listings WHERE user_id = '<user_id>';
   -- Audit trail
   SELECT * FROM audit_events WHERE actor_id = '<user_id>';
   ```

5. Export data in a portable format (JSON or CSV)
6. For deletion requests:
   - Soft-delete user records (set `deleted_at` timestamp)
   - Queue R2 file cleanup via the retention-cleanup worker
   - Retain audit logs for compliance (anonymize the actor)
7. Respond to the requester within 30 days
8. Log the DSAR completion in `audit_events`

### Monitoring DSAR Deadlines

```sql
SELECT id, created_at, status,
       created_at + INTERVAL '30 days' AS deadline,
       CASE WHEN NOW() > created_at + INTERVAL '30 days' THEN 'OVERDUE' ELSE 'OK' END AS compliance
FROM dsar_requests
WHERE status != 'completed'
ORDER BY created_at ASC;
```

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
pnpm exec playwright test --grep "@smoke" --project chromium --project mobile-chrome

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
pnpm exec wrangler deploy --config wrangler.kyc-encryptor.toml
pnpm exec wrangler deploy --config wrangler.retention-cleanup.toml
```

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

The GitHub Actions deploy workflow runs on `ubuntu-latest`, deploys the main
OpenNext worker plus auxiliary workers, then checks `${APP_URL}/api/health` and
public/auth pages. If production fails after deploy, use manual rollback from a
Linux, macOS, or WSL environment:

```bash
# Inspect recent worker versions
pnpm exec wrangler versions list

# Roll back the main OpenNext worker to the previous stable version
pnpm exec wrangler rollback
```

If the failure is tied to the recent Next.js upgrade path, prefer rolling back
to the validated `16.1.5` baseline before attempting a deeper migration to the
older `src/proxy.ts` convention.

### Worker Deployment

```bash
# Deploy individual workers
npx wrangler deploy --config wrangler.kyc-encryptor.toml
npx wrangler deploy --config wrangler.rate-limiter.toml
npx wrangler deploy --config wrangler.retention-cleanup.toml
npx wrangler deploy --config wrangler.payment-cleanup.toml

# Check worker health
curl https://verifymzansi-kyc-encryptor.verifymzansi.workers.dev/
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
4. Add provider API keys to Cloudflare Pages secrets
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
pnpm test:e2e --project=chromium --project=mobile-chrome --grep "KYC Verification Flows"
pnpm test:e2e --project=firefox --project=webkit --project=mobile-safari --grep "KYC Verification Flows"
```
