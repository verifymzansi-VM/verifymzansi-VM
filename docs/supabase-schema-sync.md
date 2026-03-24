# Supabase Schema Sync Runbook

This runbook prevents runtime schema drift in the linked Supabase project, including `PGRST205` failures and enum mismatches such as a missing `PROMOTIONS_EVENTS` marketplace area.

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

```text
tnygdgormnofpgjknlhr
```

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
- If `supabase migration list` or `supabase db push` fails with pooler auth
  errors for `postgres.tnygdgormnofpgjknlhr`, the local Postgres password is
  still not accepted by the remote database. Reconcile `SUPABASE_DB_PASSWORD`
  with the current project database password before relying on the CLI path
  again.

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
- `seller_profiles`
- `plans`
- `storefronts`
- `businesses`
- `otp_challenges`
- `verification_steps`
- `verification_sessions`
- `kyc_artifacts`

If any table returns `PGRST205`, migrations are not fully applied or PostgREST cache has not reloaded.

## 6. Preflight before deploy

```bash
pnpm run preflight:prod
```

`preflight:prod` validates schema visibility and production launch configuration.
