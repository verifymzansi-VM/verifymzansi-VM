-- Self-only management facts for the selected posts/plan cards. Values come
-- from canonical activations, payments, memberships and add-on windows.
begin;
create function internal.get_my_frontend_post_manager()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();result jsonb;
begin
  select jsonb_build_object('account_id',actor,
    'slot_usage',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'source',case e.source when 'retail_paid' then 'RETAIL_PAID' when 'intro_trial' then 'Free trial'
        when 'sponsorship' then 'SPONSORED_ORGANISATION_MEMBER' when 'contract' then 'ENTERPRISE_CONTRACT' when 'staff_grant' then 'ADMIN_GRANT' end,
      'area',case e.area when 'market' then 'MZANSI_MARKET' when 'business' then 'MZANSI_BUSINESS' when 'tourism_events' then 'PROMOTIONS_EVENTS' end,
      'planName',pay.snapshot->>'label','status',e.status,'slotCapacity',e.slot_capacity,
      'activeUsage',(select count(*) from private.post_activations a where a.entitlement_id=e.id and a.released_at is null),
      'activationCount',(select count(*) from private.post_activations a where a.entitlement_id=e.id),
      'activationLimitTotal',null,'activationLimitPerPeriod',e.activations_per_period,'activationPeriodDays',e.activation_period_days,
      'periodActivations',(select count(*) from private.post_activations a where a.entitlement_id=e.id and a.activated_at>statement_timestamp()-make_interval(days=>e.activation_period_days)),
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
      where e.owner_id=actor and e.source='retail_paid' and e.slot_capacity>1 and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)),'[]'::jsonb),
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
end$$;
revoke all on function internal.get_my_frontend_post_manager() from public,anon,authenticated,service_role;
grant execute on function internal.get_my_frontend_post_manager() to authenticated;
create function api.get_my_frontend_post_manager() returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_my_frontend_post_manager()$$;
revoke all on function api.get_my_frontend_post_manager() from public,anon,authenticated,service_role;
grant execute on function api.get_my_frontend_post_manager() to authenticated;
do $$declare before text;after text;begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.frontend_owner_post(uuid,uuid)'::regprocedure)
    <>'7859d05cd568eb95c8067d1daac18a7c' then raise exception 'owner post projection drift'; end if;
  before:=replace(pg_get_functiondef('internal.frontend_owner_post(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  after:=replace(before,'''expires_at'',p.visible_until,',
    '''expires_at'',coalesce(p.visible_until,(select f.funded_until from internal.post_funding(p.id) f)),');
  if after=before then raise exception 'owner funding anchor missing'; end if;execute after;
end$$;
notify pgrst,'reload schema';
commit;
