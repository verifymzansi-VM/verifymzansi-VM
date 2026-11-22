-- Reviewed rollback for updates/20261122130744_free_credits.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Deploy a website without the Free
-- credits page first: it would then get an error.
-- It refuses (55000) unless every piece of the update has the update's body,
-- and once any gift was given (an entitlement with the source free_credit
-- exists): a given gift is a member's slot and stays. Otherwise it puts back
-- internal.get_my_frontend_post_manager byte for byte, drops the six new
-- functions, private.free_credit_events, the two capability rows, the new
-- constraint and index, and narrows the source check to its previous list.
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce(case when v.sig = 'private.free_credit_events'
        then case when to_regclass('private.free_credit_events') is not null then 'table' end
        else (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) end,'absent')
    from (values ('internal.get_my_frontend_post_manager()'), ('private.free_credit_events'),
      ('internal.give_free_credit(text,integer,integer,text)'), ('api.give_free_credit(text,integer,integer,text)'),
      ('internal.extend_free_credit(uuid,integer,text)'), ('api.extend_free_credit(uuid,integer,text)'),
      ('internal.list_free_credits()'), ('api.list_free_credits()')) v(sig)
  loop
    if shape not in (
        'internal.get_my_frontend_post_manager() bf4e28d6a385e6823983ccb93f7315ad',
        'private.free_credit_events table',
        'internal.give_free_credit(text,integer,integer,text) 47c8bb90ea95e2e675f5897536cf9919',
        'api.give_free_credit(text,integer,integer,text) a18653758dbfb3177404bd8b083115da',
        'internal.extend_free_credit(uuid,integer,text) e2bd13cb1150afcc9aeeb5356f91535e',
        'api.extend_free_credit(uuid,integer,text) 19c0634bbd5418e3eca8e2fb4032f166',
        'internal.list_free_credits() 3844d1a2876105f451a5267503380582',
        'api.list_free_credits() ef063d6b12ce7a9b30af3af33d792cfe') then
      raise exception 'rollback precondition: the free credits update is not applied as reviewed (%)', shape
        using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from private.entitlements e where e.source='free_credit') then
    raise exception 'rollback precondition: free credits were given; they stay (use a forward fix)'
      using errcode='55000';
  end if;
end$$;

-- The member's slot list as it was before the update.
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
        when 'sponsorship' then 'SPONSORED_ORGANISATION_MEMBER' when 'contract' then 'ENTERPRISE_CONTRACT' when 'staff_grant' then 'ADMIN_GRANT' end,
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

-- The commands, the record, the capabilities and the source.
drop function api.give_free_credit(text,integer,integer,text);
drop function internal.give_free_credit(text,integer,integer,text);
drop function api.extend_free_credit(uuid,integer,text);
drop function internal.extend_free_credit(uuid,integer,text);
drop function api.list_free_credits();
drop function internal.list_free_credits();
drop table private.free_credit_events;
delete from private.staff_capabilities where role='admin' and capability in ('free_credit:give', 'free_credit:view');
drop index private.entitlements_free_credit_idx;
alter table private.entitlements drop constraint entitlements_free_credit_check;
alter table private.entitlements drop constraint entitlements_source_check;
alter table private.entitlements add constraint entitlements_source_check
  check (source = any (array['retail_paid'::text, 'intro_trial'::text, 'sponsorship'::text, 'contract'::text,
    'staff_grant'::text]));

commit;
