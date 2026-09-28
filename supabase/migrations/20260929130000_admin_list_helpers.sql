-- Admin list pages: one query instead of one per row, and sums in the
-- database instead of reading whole tables into the page.
--
--   staff_directory(ids)          names and emails for people shown on a page
--                                 (replaces one Auth API call per person)
--   organisation_list_counts(ids) affiliated, sponsored and pending counts
--                                 per organisation (replaces reading every
--                                 active row of three tables)
--   partner_referral_counts(ids)  accounts referred per partner (replaces
--                                 reading every referred account)
--   revenue_summary()             payment and invoice totals (replaces reading
--                                 every payment and invoice in pages of 1,000)
--   trial_entitlements_for(ids)   trial entitlement per account (replaces one
--                                 call per search result)
--
-- All are service-role only; the calling page has already checked the
-- viewer's capability.

BEGIN;

CREATE OR REPLACE FUNCTION public.staff_directory(p_ids uuid[])
RETURNS TABLE (user_id uuid, email text, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.email::text, nullif(btrim(p.display_name), '')
    FROM auth.users u
    LEFT JOIN public.account_profiles p ON p.user_id = u.id
   WHERE u.id = ANY (p_ids[1:1000]);
$$;

CREATE OR REPLACE FUNCTION public.organisation_list_counts(p_ids uuid[])
RETURNS TABLE (organisation_id uuid, affiliated integer, sponsored integer, pending integer)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT o.id,
         (SELECT count(*)::integer FROM public.organisation_affiliations a
           WHERE a.organisation_id = o.id AND a.status = 'active'),
         (SELECT count(*)::integer FROM public.organisation_sponsorships s
           WHERE s.organisation_id = o.id AND s.status = 'active'),
         (SELECT count(*)::integer FROM public.organisation_applications x
           WHERE x.organisation_id = o.id AND x.status = 'submitted')
    FROM unnest(p_ids[1:500]) AS o(id);
$$;

CREATE OR REPLACE FUNCTION public.partner_referral_counts(p_ids uuid[])
RETURNS TABLE (partner_id uuid, referrals integer)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p.id, (SELECT count(*)::integer FROM public.account_acquisition a WHERE a.partner_id = p.id)
    FROM unnest(p_ids[1:1000]) AS p(id);
$$;

CREATE INDEX IF NOT EXISTS account_acquisition_partner_idx
  ON public.account_acquisition (partner_id) WHERE partner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.revenue_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'transactions', (SELECT count(*) FROM public.payments),
    'completed_count', (SELECT count(*) FROM public.payments WHERE status = 'complete'),
    'completed_cents', (SELECT coalesce(sum(amount_cents), 0) FROM public.payments WHERE status = 'complete'),
    'failed_count', (SELECT count(*) FROM public.payments WHERE status = 'failed'),
    'failed_cents', (SELECT coalesce(sum(amount_cents), 0) FROM public.payments WHERE status = 'failed'),
    'pending_cents', (SELECT coalesce(sum(amount_cents), 0) FROM public.payments WHERE status = 'pending'),
    'by_area', coalesce((
      SELECT jsonb_agg(jsonb_build_object('area', area, 'cents', cents) ORDER BY cents DESC)
        FROM (SELECT area::text AS area, sum(amount_cents) AS cents
                FROM public.payments WHERE status = 'complete' GROUP BY area) t), '[]'::jsonb),
    -- The last 12 months, by South African calendar month.
    'by_month', coalesce((
      SELECT jsonb_agg(jsonb_build_object('month', to_char(month, 'YYYY-MM'), 'cents', cents) ORDER BY month)
        FROM (SELECT date_trunc('month', created_at AT TIME ZONE 'Africa/Johannesburg') AS month,
                     sum(amount_cents) AS cents
                FROM public.payments
               WHERE status = 'complete'
                 AND created_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Johannesburg')
                                   AT TIME ZONE 'Africa/Johannesburg' - interval '11 months'
               GROUP BY 1) t), '[]'::jsonb),
    'invoice_vat_cents', (SELECT coalesce(sum(vat_cents), 0) FROM public.invoices),
    'invoice_total_cents', (SELECT coalesce(sum(total_cents), 0) FROM public.invoices)
  );
$$;

CREATE OR REPLACE FUNCTION public.trial_entitlements_for(p_ids uuid[])
RETURNS TABLE (user_id uuid, entitlement text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, public.trial_entitlement_for(u.id) FROM unnest(p_ids[1:50]) AS u(id);
$$;

REVOKE EXECUTE ON FUNCTION public.staff_directory(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.organisation_list_counts(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.partner_referral_counts(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revenue_summary() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trial_entitlements_for(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_directory(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.organisation_list_counts(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_referral_counts(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.revenue_summary() TO service_role;
GRANT EXECUTE ON FUNCTION public.trial_entitlements_for(uuid[]) TO service_role;

COMMIT;
