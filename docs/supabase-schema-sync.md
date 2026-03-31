# Supabase Schema Sync Runbook

This runbook prevents runtime schema drift in the linked Supabase project, including PGRST205 failures, missing policy columns on account_profiles, and enum mismatches such as a missing PROMOTIONS_EVENTS marketplace area.

## 1. Install Supabase CLI

Use one of the following:

```bash
npx supabase --version
```

If the command is missing, either use `npx supabase ...` directly or install the CLI using your preferred package manager and verify it works.

## 2. Link the local repo to the remote Supabase project

```bash
npx supabase link --project-ref <your-project-ref>
```

Use the project ref from your Supabase dashboard URL or `NEXT_PUBLIC_SUPABASE_URL`.

Current production project ref in this workspace:

tnygdgormnofpgjknlhr

## 3. Apply migrations from this repo

From the repository root:

```bash
npx supabase db push
```

This applies SQL files in `supabase/migrations` to the linked remote database.

Important current state:

- The linked production project has the billing policy migration applied:
  `20260319103000_explicit_billing_service_role_policies.sql`
- The linked production project also has the follow-up moderator visibility
  migration applied for `kyc_evidence_access_logs`:
  `20260319171500_expand_kyc_evidence_access_log_staff_read.sql`
- The linked production project also has the follow-up explicit audit/intake
  insert-policy migration applied:
  `20260319194000_explicit_audit_service_role_insert_policies.sql`
- If supabase migration list or supabase db push fails with pooler auth
  errors for postgres.tnygdgormnofpgjknlhr, the local Postgres password is
  still not accepted by the remote database. Reconcile `SUPABASE_DB_PASSWORD`
  with the current project database password before relying on the CLI path
  again.

### 3a. If CLI project auth fails with Unauthorized

If you see Unauthorized from supabase link even with a token present:

```bash
supabase login --token "$SUPABASE_ACCESS_TOKEN"
```

Then retry link and migration commands.

### 3b. If DB password auth fails (SQLSTATE 28P01)

If the CLI can read via service-role checks but cannot connect for migration operations:

1. Apply the missing migration in Supabase Dashboard SQL Editor:
   - supabase/migrations/20260331000000_identity_lock_and_contact_cooldowns.sql
2. After running the migration SQL, reload PostgREST schema cache:

```sql
NOTIFY pgrst, 'reload schema';
```

1. Re-run verification from repo root:

```bash
pnpm db:verify-schema
```

If the database is missing the `PROMOTIONS_EVENTS` marketplace area enum value, make sure the latest migrations include:

- `20260307113000_add_promotions_events_marketplace_area.sql`
- `20260307110000_add_rejected_seller_verification_status.sql`
- `20260319103000_explicit_billing_service_role_policies.sql`
- `20260319171500_expand_kyc_evidence_access_log_staff_read.sql`
- `20260319194000_explicit_audit_service_role_insert_policies.sql`

## 4. Reload PostgREST schema cache

Run the following SQL in Supabase SQL editor:

```sql
NOTIFY pgrst, 'reload schema';
```

If you apply a migration through an alternative database-admin path instead of
the CLI, still reload the schema cache before running API-level verification.

## 5. Verify required tables are visible through PostgREST

```bash
pnpm run db:verify-schema
```

This checks:

- `listings`
- `promotions`
- absence of seller_profiles
- `plans`
- `storefronts`
- `businesses`
- `otp_challenges`
- `verification_steps`
- `verification_sessions`
- `kyc_artifacts`

It also validates required account_profiles policy columns used by profile update enforcement:

- pending_phone
- location_verified_at
- legal_name_locked_at
- contact_last_phone_change_at
- contact_last_email_change_at
- pending_email

If verification fails with 42703 for account_profiles policy columns, apply the identity-lock migration and reload schema cache.

## 6. Preflight before deploy

```bash
pnpm run preflight:prod
```

`preflight:prod` validates schema visibility and production launch configuration.
