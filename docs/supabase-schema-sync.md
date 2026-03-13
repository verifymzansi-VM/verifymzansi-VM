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

If the database is missing the `PROMOTIONS_EVENTS` marketplace area enum value, make sure the latest migrations include:

- `20260307113000_add_promotions_events_marketplace_area.sql`
- `20260307110000_add_rejected_seller_verification_status.sql`

## 4. Reload PostgREST schema cache

Run the following SQL in Supabase SQL editor:

```sql
NOTIFY pgrst, 'reload schema';
```

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
