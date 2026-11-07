-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_frontend_posting_allowance(p_area text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();fingerprint text;claimed boolean;eligible boolean;result jsonb;
begin
  if p_area is null or p_area not in('market','business','tourism_events') then
    raise exception 'posting area required' using errcode='22023';end if;
  fingerprint:=internal.current_verified_identity(actor);
  claimed:=exists(select 1 from private.trial_identities t where t.owner_id=actor or t.identity_hmac=fingerprint);
  eligible:=not claimed and not exists(select 1 from private.banned_identities b where b.identity_hmac=fingerprint and b.retain_until>clock_timestamp());
  -- Eligibility here is a display hint, including before identity review. The
  -- existing grant derives the verified identity and rechecks claims atomically.
  with usable as (
    select e.*,pay.snapshot from private.entitlements e left join private.payments pay on pay.id=e.payment_id
    where (e.area is null or e.area=p_area) and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
      and (e.owner_id=actor or exists(select 1 from private.entitlement_members m where m.entitlement_id=e.id and m.member_id=actor))
      and exists(select 1 from private.current_account_access a where a.id=e.owner_id)
      and (e.source<>'retail_paid' or (pay.status='complete' and pay.owner_id=e.owner_id))
  ) select jsonb_build_object(
    'account_id',actor,'profile_exists',exists(select 1 from private.profiles p where p.account_id=actor),
    'capacity',coalesce(sum(u.slot_capacity),0),
    'used',(select count(*) from private.post_activations a where a.entitlement_id in(select id from usable) and a.released_at is null),
    'max_photos',coalesce(max(u.max_photos),case when eligible then 10 else 0 end),
    'max_videos',coalesce(max(u.max_videos),case when eligible then 1 else 0 end),
    'tier',case when count(*)=0 then 'free' else coalesce((select case when x.slot_capacity>1 then 'enterprise'
      when (x.snapshot->>'duration_days')::integer=30 then 'month' when (x.snapshot->>'duration_days')::integer=90 then 'quarter'
      when (x.snapshot->>'duration_days')::integer=180 then 'half_year' else 'active' end
      from usable x where x.source='retail_paid' order by (x.snapshot->>'duration_days')::integer desc,x.id limit 1),'active') end,
    'trial_ends_at',max(u.ends_at) filter(where u.source='intro_trial'),
    'trial_used',claimed,'trial_offer',jsonb_build_object('eligible',eligible,'sevenDayAvailable',eligible,
      'thirtyDayAvailable',eligible,'remaining',null,'launchEnabled',true,'shortDays',7,'longDays',30)
  ) into result from usable u;
  perform internal.price_draft_actor();return result;
end$function$;
alter function internal.get_my_frontend_posting_allowance(text) owner to postgres;
revoke all on function internal.get_my_frontend_posting_allowance(text) from public;
grant execute on function internal.get_my_frontend_posting_allowance(text) to authenticated;
