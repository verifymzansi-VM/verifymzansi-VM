-- Reviewed rollback for updates/20261125044115_retire_paid_addons.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. The website reads these replies
-- with or without the add-on fields, so no website change is needed either
-- way.
-- It puts back the earlier bodies of internal.billing_catalogue,
-- internal.get_my_billing and internal.get_my_frontend_post_manager. The
-- three add-on versions stay retired: catalogue versions are immutable
-- (internal.catalogue_version_guard), so the catalogue then lists no add-on
-- and api.start_checkout still refuses them. It refuses unless all three
-- functions have the update's bodies.
begin;
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
        'internal.billing_catalogue() 9b88a341204050c9f58dbae7001beb7b',
        'internal.get_my_billing() d5a162ab5bd63b0fed7d6aa0e1a45600',
        'internal.get_my_frontend_post_manager() ee13e414005ffc5cdf6d4f1ba648ebfe') then
      raise exception 'rollback precondition: the paid add-ons update is not applied (%)', shape using errcode='55000';
    end if;
  end loop;
end$$;

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
        'slot_capacity', p.slot_capacity, 'max_photos', p.max_photos, 'max_videos', p.max_videos,
        'addon_capabilities',to_jsonb(p.addon_capabilities))
        order by p.price_cents, p.plan_code)
      from private.plan_versions p where p.is_public and p.retired_at is null), '[]'),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'days', a.days,
        'price_cents', a.price_cents::text, 'currency', a.currency) order by a.kind, a.days)
      from private.addon_versions a where a.retired_at is null), '[]'));
$function$;
alter function internal.billing_catalogue() owner to postgres;
revoke all on function internal.billing_catalogue() from public;
grant execute on function internal.billing_catalogue() to anon;
grant execute on function internal.billing_catalogue() to authenticated;

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
      'max_photos',e.max_photos,'max_videos',e.max_videos,'addon_capabilities',to_jsonb(e.addon_capabilities),
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
      where a.owner_id=actor and a.released_at is null and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)),'[]'::jsonb),
    'addons',coalesce((select jsonb_agg(jsonb_build_object('post_id',p.id,
      'boost_until',(select max(w.ends_at) from private.post_addon_windows w where w.post_id=p.id and w.kind='boost' and w.revoked_at is null and w.starts_at<=statement_timestamp() and w.ends_at>statement_timestamp()),
      'featured_until',(select max(w.ends_at) from private.post_addon_windows w where w.post_id=p.id and w.kind='featured' and w.revoked_at is null and w.starts_at<=statement_timestamp() and w.ends_at>statement_timestamp()),
      'urgent_until',(select max(w.ends_at) from private.post_addon_windows w where w.post_id=p.id and w.kind='urgent' and w.revoked_at is null and w.starts_at<=statement_timestamp() and w.ends_at>statement_timestamp())) order by p.id)
      from private.posts p where p.owner_id=actor and p.edit_of is null and exists(select 1 from private.post_addon_windows w
        where w.post_id=p.id and w.revoked_at is null and w.starts_at<=statement_timestamp() and w.ends_at>statement_timestamp())),'[]'::jsonb)) into result;
  perform internal.price_draft_actor();return result;
end$function$;
alter function internal.get_my_frontend_post_manager() owner to postgres;
revoke all on function internal.get_my_frontend_post_manager() from public;
grant execute on function internal.get_my_frontend_post_manager() to authenticated;

commit;
