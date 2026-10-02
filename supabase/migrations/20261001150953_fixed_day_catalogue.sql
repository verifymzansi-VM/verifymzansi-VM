-- Align the live catalogue with Document 03 v3.2 (Document 08, Phase 0).
--
-- Group 1: R50 / 30 days, R140 / 90 days, R250 / 180 days, all fixed-day.
--   The existing R250 "6 Months" row was already 180 fixed days, so it is
--   relabelled in place (plans has one row per area and tier). The 12-month
--   rows are retired, hidden and marked legacy.
-- Group 2: 10, 25, 50 and 100 slots for 90 or 180 days; above 100 is quoted.
--   Every earlier enterprise code (50-500 slots, 3/6/12 months) is retired.
-- Founding defaults: Group 3 pilots 90 days / 25 businesses / 3 admins;
--   Group 2 founding partners 90 days / 10 slots / 2 admins.
--
-- Retirement is not deletion: retired_at lets in-flight checkouts complete at
-- the quoted price, and purchased terms keep their recorded expiry.
BEGIN;

UPDATE public.plans p SET
  name = a.label || ' — 180 Days',
  plan_code = 'RETAIL_180D',
  promo_label = 'Best value',
  compare_at_cents = 30000,
  sort_order = 30
FROM (VALUES ('MZANSI_MARKET'::public.marketplace_area,'Mzansi Market'),('MZANSI_BUSINESS','Mzansi Business'),
  ('PROMOTIONS_EVENTS','Tourism')) a(area,label)
WHERE p.area = a.area AND p.tier = 'half_year' AND NOT p.is_legacy;

UPDATE public.plans SET sort_order = 10, promo_label = 'Flexible' WHERE tier = 'month' AND NOT is_legacy;

INSERT INTO public.plans(area,tier,name,price_cents,billing_frequency,features,active,plan_code,duration_days,slot_capacity,
  monthly_activation_limit,public,promo_label,compare_at_cents,sort_order)
SELECT m.area, 'quarter', a.label || ' — 90 Days', 14000, 'fixed_term', m.features, true, 'RETAIL_90D', 90, 1,
  m.monthly_activation_limit, true, 'Popular', 15000, 20
FROM public.plans m
JOIN (VALUES ('MZANSI_MARKET'::public.marketplace_area,'Mzansi Market'),('MZANSI_BUSINESS','Mzansi Business'),
  ('PROMOTIONS_EVENTS','Tourism')) a(area,label) ON a.area = m.area
WHERE m.tier = 'month' AND m.plan_code = 'RETAIL_30D'
ON CONFLICT DO NOTHING;

-- Retire 12-month retail and every calendar-month enterprise code.
UPDATE public.plans SET active = false, public = false, is_legacy = true, retired_at = COALESCE(retired_at, now())
WHERE (tier = 'year' OR (tier = 'enterprise' AND plan_code !~ '^ENT_(10|25|50|100)_(90|180)D$'))
  AND NOT is_legacy;

INSERT INTO public.plans(area,tier,name,price_cents,billing_frequency,features,active,plan_code,duration_days,slot_capacity,
  monthly_activation_limit,public,sort_order)
SELECT NULL, 'enterprise', 'Multi-listing — ' || s.slots || ' slots, ' || d.days || ' days', s.prices[d.i], 'fixed_term',
  jsonb_build_object('maxPhotos',10,'maxVideos',1,'videoAllowed',true,'boostAllowed',true,'featuredAllowed',true,'urgentAllowed',true),
  true, 'ENT_' || s.slots || '_' || d.days || 'D', d.days, s.slots, s.slots * 2, true, 200 + s.slots + d.i
FROM (VALUES
 (10, ARRAY[120000,215000]),
 (25, ARRAY[270000,485000]),
 (50, ARRAY[500000,900000]),
 (100, ARRAY[900000,1600000])
) s(slots,prices)
CROSS JOIN (VALUES (1,90),(2,180)) d(i,days)
ON CONFLICT DO NOTHING;

-- Founding packages are exactly 90 days (Document 03 §6).
UPDATE public.commercial_settings SET value = value || '{"durationDays":90,"sponsoredCapacity":25,"adminLimit":3}'::jsonb,
  updated_at = now()
WHERE key = 'founding_organisation';
UPDATE public.commercial_settings SET value = value || '{"durationDays":90,"slotCapacity":10,"activationsPerPeriod":20,"adminLimit":2}'::jsonb,
  updated_at = now()
WHERE key = 'founding_commercial';
UPDATE public.commercial_settings SET value = value || '{"durationDays":90}'::jsonb, updated_at = now()
WHERE key = 'strategic';
ALTER TABLE public.organisations ALTER COLUMN sponsored_capacity SET DEFAULT 25;

-- Retail plans auto-approve partner commission; the new 90-day tier is retail.
CREATE OR REPLACE FUNCTION public.payment_commission_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE acq public.account_acquisition; p public.partners; meta jsonb; tier text; rate integer; manual boolean;
BEGIN
 IF NEW.status::text = OLD.status::text THEN RETURN NULL; END IF;
 IF NEW.status::text IN ('refunded','chargeback') THEN
  UPDATE public.commissions SET status = 'REVERSED', reversed_at = now(),
   reversal_reason = 'Payment ' || NEW.status::text WHERE payment_id = NEW.id AND status <> 'REVERSED';
  INSERT INTO public.notifications(user_id,type,title,message,href)
  SELECT pa.user_id,'warning','Commission reversed','A referred payment was ' || NEW.status::text || ', so its commission was reversed.','/dashboard/partner'
  FROM public.commissions c JOIN public.partners pa ON pa.id = c.partner_id WHERE c.payment_id = NEW.id;
  RETURN NULL;
 END IF;
 IF NEW.status::text <> 'complete' OR NEW.amount_cents <= 0 THEN RETURN NULL; END IF;
 IF NOT COALESCE((SELECT (value->>'enabled')::boolean FROM public.commercial_settings WHERE key = 'partner'), true) THEN RETURN NULL; END IF;
 SELECT * INTO acq FROM public.account_acquisition WHERE user_id = NEW.user_id;
 IF acq.partner_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO p FROM public.partners WHERE id = acq.partner_id;
 IF p.id IS NULL OR p.status <> 'active' OR p.user_id = NEW.user_id THEN RETURN NULL; END IF;
 meta := COALESCE(NEW.provider_data->'metadata', NEW.provider_data, '{}'::jsonb);
 tier := meta->>'plan_tier';
 -- Institutional and legacy plan revenue is never auto-commissioned.
 manual := meta->>'type' = 'subscription' AND COALESCE(tier,'') NOT IN ('month','quarter','half_year','year');
 rate := COALESCE(p.commission_bps, public.commercial_setting_int('partner','commissionBps',2000));
 INSERT INTO public.commissions(partner_id,payment_id,referred_user_id,base_cents,rate_bps,amount_cents,requires_manual_approval,eligible_at)
 VALUES (p.id,NEW.id,NEW.user_id,NEW.amount_cents,rate,floor(NEW.amount_cents::numeric * rate / 10000)::integer,manual,
  now() + make_interval(days => public.commercial_setting_int('partner','pendingDays',30)))
 ON CONFLICT (payment_id) DO NOTHING;
 RETURN NULL;
END;
$function$;

-- Expiry notices: name only products that are on sale, add the ~30-day
-- reminder Document 03 §7 requires for longer terms, and tell a multi-listing
-- plan's named administrators as well as its buyer.
CREATE OR REPLACE FUNCTION public.notify_commercial_lifecycle()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE e record; m text; inserted integer; total integer := 0;
BEGIN
 FOR e IN SELECT s.*, (SELECT count(*) FROM public.slot_assignments a WHERE a.entitlement_id = s.id AND a.released_at IS NULL) AS used
  FROM public.slot_entitlements s WHERE s.user_id IS NOT NULL AND s.expires_at > now() - interval '2 days' LOOP
  m := CASE
   WHEN e.expires_at <= now() THEN 'expired'
   WHEN e.expires_at <= now() + interval '1 day' THEN 'expiring_1'
   WHEN e.expires_at <= now() + interval '7 days' AND e.expires_at - e.starts_at > interval '20 days' THEN 'expiring_7'
   WHEN e.expires_at <= now() + interval '30 days' AND e.expires_at - e.starts_at > interval '60 days' THEN 'expiring_30'
   ELSE NULL END;
  IF m IS NOT NULL THEN
   INSERT INTO public.commercial_notices(subject_id,milestone) VALUES (e.id,m) ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS inserted = ROW_COUNT;
   IF inserted = 1 THEN
    INSERT INTO public.notifications(user_id,type,title,message,href)
    SELECT r.user_id,
     CASE WHEN m = 'expired' THEN 'warning' ELSE 'info' END,
     CASE WHEN e.source = 'SPONSORED_ORGANISATION_MEMBER' THEN CASE WHEN m = 'expired' THEN 'Sponsored visibility has ended' ELSE 'Sponsored visibility ends soon' END
      WHEN e.source IN ('STRATEGIC_INDIVIDUAL','FOUNDING_COMMERCIAL_PARTNER') THEN CASE WHEN m = 'expired' THEN 'Your programme has ended' ELSE 'Your programme ends soon' END
      ELSE CASE WHEN m = 'expired' THEN 'Your plan has expired' ELSE 'Your plan expires soon' END END,
     CASE WHEN m = 'expired' THEN 'Your posts are saved in your dashboard. Reactivate from R50 / 30 days, R140 / 90 days or R250 / 180 days.'
      ELSE 'Ends on ' || to_char(e.expires_at AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY HH24:MI') ||
       ' SAST. Nothing renews automatically. Buy a new term to keep your posts visible.' END,
     '/dashboard/listings'
    FROM (SELECT e.user_id UNION SELECT mm.user_id FROM public.slot_entitlement_members mm WHERE mm.entitlement_id = e.id) r(user_id);
    total := total + 1;
   END IF;
  END IF;
  IF e.expires_at > now() AND e.used >= e.slot_capacity AND e.slot_capacity > 0 THEN
   INSERT INTO public.commercial_notices(subject_id,milestone) VALUES (e.id,'capacity_' || e.slot_capacity) ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS inserted = ROW_COUNT;
   IF inserted = 1 THEN
    INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (e.user_id,'info','All posting slots are in use',
     'Mark a sold item, deactivate a post, or add a slot to publish more.','/dashboard/listings');
    total := total + 1;
   END IF;
  END IF;
 END LOOP;
 RETURN total;
END;
$function$;

SELECT public.commercial_audit(NULL, 'catalogue_aligned', 'plans', NULL, NULL,
  jsonb_build_object('retail', 'RETAIL_30D/90D/180D', 'enterprise', 'ENT_{10,25,50,100}_{90,180}D', 'founding', '90 days'),
  'Document 03 v3.2 fixed-day catalogue (Document 08 Phase 0)');
COMMIT;
