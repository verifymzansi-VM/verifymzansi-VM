-- Retire the paid add-ons (launch checklist item 37, owner's decision).
--
-- Urgent, Boost and Featured are no longer sold. The website stopped offering
-- them in pull request #358 (no button, price or route), and its readers have
-- accepted the add-on fields as missing since that release. This update makes
-- the database match:
--
-- 1. The three add-on versions (boost, featured and urgent, version 1) are
--    retired: private.addon_versions.retired_at is set. Catalogue versions are
--    immutable (internal.catalogue_version_guard), so a retirement is final;
--    selling an add-on again would need a new version in a new update.
--    api.start_checkout sells only add-ons since
--    20261113002421_individual_slots_r69.sql (slots have their own checkout),
--    and it reads only versions that are not retired, so from now on it
--    refuses every product with 22023 "product not available" and creates no
--    payment. The command stays: it is part of the reviewed baseline
--    (candidate.sql and api-manifest.json), nothing in the website calls it,
--    and an inert command needs no contract step.
-- 2. internal.billing_catalogue (api.billing_catalogue, the public price list)
--    no longer returns the "addons" list or each plan's "addon_capabilities".
-- 3. internal.get_my_billing (api.get_my_billing) no longer returns each
--    slot's "addon_capabilities".
-- 4. internal.get_my_frontend_post_manager (My posts) no longer returns the
--    "addons" dates.
--    Every other field of these three reads is unchanged.
--
-- Kept on purpose: the add-on tables and columns (private.addon_versions,
-- private.post_addon_windows, the add-on columns of private.payments, and
-- addon_capabilities on plan versions and slots) hold history and are tied to
-- checks, foreign keys and immutability guards; the settlement, staff
-- activation and refund paths for add-on payments stay, so any add-on payment
-- already on record is still shown in receipts and staff lists and can still
-- be refunded. A pending add-on payment expires within the hour through
-- internal.expire_stale_checkouts, as before; the website has refused to send
-- one to Ozow since add-on sales were paused.
--
-- No API command, argument, return type or grant changes; only fields inside
-- three jsonb replies are removed, which the live website already accepts.
-- ORDER: apply first, then merge.
-- It refuses with 55000 unless each of the three functions has its reviewed
-- body (or this update's). Run again, it changes nothing.
-- Read-only preflight: ../preflight/20261125044115_retire_paid_addons.check.sql.
-- Rollback: ../rollback/20261125044115_retire_paid_addons.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.billing_catalogue()'),
      ('internal.get_my_billing()'),
      ('internal.get_my_frontend_post_manager()')) v(sig)
  loop
    if shape not in (
        'internal.billing_catalogue() f0c5673fcf9b37b603eac1866472e3d8',
        'internal.billing_catalogue() 9b88a341204050c9f58dbae7001beb7b',
        'internal.get_my_billing() 8c89e002e759c1f5a7c47f92ce465990',
        'internal.get_my_billing() d5a162ab5bd63b0fed7d6aa0e1a45600',
        'internal.get_my_frontend_post_manager() bf4e28d6a385e6823983ccb93f7315ad',
        'internal.get_my_frontend_post_manager() ee13e414005ffc5cdf6d4f1ba648ebfe') then
      raise exception 'retire paid add-ons drift: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
end$$;

-- 1. Retire the add-on versions (once; a retired version stays retired).
update private.addon_versions set retired_at=statement_timestamp() where retired_at is null;

-- 2. The public price list without add-ons.
CREATE OR REPLACE FUNCTION internal.billing_catalogue()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.plan_code, 'label', p.label,
        'area', p.area, 'price_cents', p.price_cents::text, 'currency', p.currency, 'duration_days', p.duration_days,
        'activation_period_days', p.activation_period_days, 'activations_per_period', p.activations_per_period,
        'slot_capacity', p.slot_capacity, 'max_photos', p.max_photos, 'max_videos', p.max_videos)
        order by p.price_cents, p.plan_code)
      from private.plan_versions p where p.is_public and p.retired_at is null), '[]'));
$function$;
alter function internal.billing_catalogue() owner to postgres;
revoke all on function internal.billing_catalogue() from public;
grant execute on function internal.billing_catalogue() to anon;
grant execute on function internal.billing_catalogue() to authenticated;

-- 3. The member's billing without add-on capabilities.
CREATE OR REPLACE FUNCTION internal.get_my_billing()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object(
    'payments',coalesce((select jsonb_agg(internal.billing_payment_dto(p) order by p.created_at desc)
      from (select * from private.payments where owner_id=actor order by created_at desc limit 100) p),'[]'),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'payment_id',p.id,
      'invoice_number',i.invoice_number,'total_cents',i.total_cents::text,
      'amount_ex_vat_cents',i.amount_ex_vat_cents::text,'vat_cents',i.vat_cents::text,
      'description',i.description,'issued_at',i.issued_at,'payment_status',p.status) order by i.issued_at desc)
      from (select * from private.payments where owner_id=actor order by created_at desc limit 100) p
      join private.invoices i on i.payment_id=p.id),'[]'),
    'entitlements',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'area',e.area,
      'source',e.source,'status',e.status,'slot_capacity',e.slot_capacity,
      'max_photos',e.max_photos,'max_videos',e.max_videos,
      'starts_at',e.starts_at,'ends_at',e.ends_at,'used',(select count(*) from private.post_activations a
        where a.entitlement_id=e.id and a.released_at is null)))
      from private.entitlements e where (e.owner_id=actor or exists(select 1 from private.entitlement_members m
        where m.entitlement_id=e.id and m.member_id=actor)) and e.status='active'
      and e.starts_at<=statement_timestamp() and e.ends_at>statement_timestamp()
      and exists(select 1 from private.current_account_access a where a.id=e.owner_id)),'[]')) into result;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_my_billing() owner to postgres;
revoke all on function internal.get_my_billing() from public;
grant execute on function internal.get_my_billing() to authenticated;

-- 4. My posts without add-on dates.
CREATE OR REPLACE FUNCTION internal.get_my_frontend_post_manager()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();result jsonb;
begin
  select jsonb_build_object('account_id',actor,
    'slot_usage',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'source',case e.source when 'retail_paid' then 'RETAIL_PAID' when 'intro_trial' then 'Free trial'
        when 'sponsorship' then 'SPONSORED_ORGANISATION_MEMBER' when 'contract' then 'ENTERPRISE_CONTRACT' when 'staff_grant' then 'ADMIN_GRANT'
        when 'free_credit' then 'FREE_CREDIT' end,
      'area',case e.area when 'market' then 'MZANSI_MARKET' when 'business' then 'MZANSI_BUSINESS' when 'tourism_events' then 'PROMOTIONS_EVENTS' end,
      'planName',pay.snapshot->>'label','status',e.status,'slotCapacity',e.slot_capacity,
      'activeUsage',internal.slot_posts_held(e.id),
      'activationCount',(select count(*) from private.post_activations a where a.entitlement_id=e.id),
      'activationLimitTotal',null,'activationLimitPerPeriod',e.activations_per_period,'activationPeriodDays',e.activation_period_days,
      'periodActivations',internal.slot_posts_started(e.id,statement_timestamp()-make_interval(days=>e.activation_period_days)),
      'startsAt',e.starts_at,'expiresAt',e.ends_at,'autoRenew',false,'sponsored',e.source='sponsorship') order by e.ends_at,e.id)
      from private.entitlements e left join private.payments pay on pay.id=e.payment_id
      where (e.owner_id=actor or exists(select 1 from private.entitlement_members m where m.entitlement_id=e.id and m.member_id=actor))
      and internal.entitlement_usable(e.status,e.starts_at,e.ends_at) and exists(select 1 from private.current_account_access a where a.id=e.owner_id)
      and (e.source<>'retail_paid' or pay.status='complete')),'[]'::jsonb),
    'plan_admins',coalesce((select jsonb_agg(jsonb_build_object('entitlementId',e.id,'slotCapacity',e.slot_capacity,'expiresAt',e.ends_at,
      'admins',coalesce((select jsonb_agg(jsonb_build_object('name',coalesce(internal.profile_public_name(pr.display_name),'Member'),
        'email',u.email) order by m.member_id) from private.entitlement_members m join auth.users u on u.id=m.member_id
        left join private.profiles pr on pr.account_id=m.member_id where m.entitlement_id=e.id),'[]'::jsonb)))
      from private.entitlements e join private.payments p on p.id=e.payment_id and p.status='complete'
      where e.owner_id=actor and e.source='retail_paid' and e.slot_capacity>1 and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
        -- a Multi-listing package's team belongs to the package (P4c), never to a grant
        and e.package_id is null),'[]'::jsonb),
    'sponsored_post_ids',coalesce((select jsonb_agg(a.post_id order by a.post_id) from private.post_activations a
      join private.entitlements e on e.id=a.entitlement_id and e.source='sponsorship'
      where a.owner_id=actor and a.released_at is null and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)),'[]'::jsonb)) into result;
  perform internal.price_draft_actor();return result;
end$function$;
alter function internal.get_my_frontend_post_manager() owner to postgres;
revoke all on function internal.get_my_frontend_post_manager() from public;
grant execute on function internal.get_my_frontend_post_manager() to authenticated;

commit;
