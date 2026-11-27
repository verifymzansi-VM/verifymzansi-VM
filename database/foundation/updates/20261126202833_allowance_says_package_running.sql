-- The posting allowance says whether a Multi-listing package is running
-- (launch checklist item 80). api.get_my_frontend_posting_allowance_v2, which
-- every post form already reads, gains one top-level key, package_running
-- (boolean): true while the caller's own Multi-listing package runs, by the
-- same rule as api.list_my_post_templates (internal.slot_package_now: a
-- completed payment, an active grant inside its dates, an account that can
-- use it). The answer is the same for every posting area. The Edit listing
-- page's "Save as template" button reads it from the allowance the page
-- already loads, so it no longer sends a request of its own.
--
-- Expand only: one key added to one answer; no command, argument or grant
-- changes (only internal.get_my_frontend_posting_allowance_v2's body).
-- ORDER: website first. The website's allowance parser is strict, so it must
-- accept the new key (as optional) before this is applied. Until it is
-- applied, the new website reads a missing key as "no package" and does not
-- show Save as template on Edit listing; nothing else changes.
-- It refuses with 55000 unless the function has its reviewed body (or this
-- update's).
-- Read-only preflight: ../preflight/20261126202833_allowance_says_package_running.check.sql.
-- Rollback: ../rollback/20261126202833_allowance_says_package_running.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.get_my_frontend_posting_allowance_v2(text)');
  if body is null or body not in('18edc8cd354b8990c7b557fa4f00eea3','76cb38d3421bb1910b1cd40a2d85082c') then
    raise exception 'package running in the allowance precondition: internal.get_my_frontend_posting_allowance_v2(text) is not the reviewed body (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

CREATE OR REPLACE FUNCTION internal.get_my_frontend_posting_allowance_v2(p_area text)
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
  -- A post waiting for the free week (internal.queue_intro_trial) uses the
  -- offer. The free week is 7 days: the 30-day choice is not available.
  eligible:=not claimed and not exists(select 1 from private.banned_identities b where b.identity_hmac=fingerprint and b.retain_until>clock_timestamp())
    and not internal.intro_trial_waiting(actor);
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
    'used',coalesce(sum(a.active_count),0),
    'creation_remaining',coalesce(sum(greatest(0,least(u.slot_capacity-a.active_count,
        coalesce(u.activations_per_period-a.period_count,u.slot_capacity)))),0),
    'max_photos',coalesce(max(u.max_photos),case when eligible then 10 else 0 end),
    'max_videos',coalesce(max(u.max_videos),case when eligible then 1 else 0 end),
    'tier',case when count(*)=0 then 'free' else coalesce((select case when x.slot_capacity>1 then 'enterprise'
      when (x.snapshot->>'duration_days')::integer=30 then 'month' when (x.snapshot->>'duration_days')::integer=90 then 'quarter'
      when (x.snapshot->>'duration_days')::integer=180 then 'half_year' else 'active' end
      from usable x where x.source='retail_paid' order by (x.snapshot->>'duration_days')::integer desc,x.id limit 1),'active') end,
    'trial_ends_at',max(u.ends_at) filter(where u.source='intro_trial'),
    'trial_used',claimed,'trial_offer',jsonb_build_object('eligible',eligible,'sevenDayAvailable',eligible,
      'thirtyDayAvailable',false,'remaining',null,'launchEnabled',true,'shortDays',7,'longDays',30),
    -- Save as template on the Edit listing page reads this instead of its own
    -- request (the same rule as internal.list_my_post_templates).
    'package_running',exists(select 1 from internal.slot_package_now(actor))
  ) into result from usable u cross join lateral (
      select internal.slot_posts_held(u.id) as active_count,
        internal.slot_posts_started(u.id,statement_timestamp()-make_interval(days=>u.activation_period_days)) as period_count
    ) a;
  perform internal.price_draft_actor();return result;
end$function$;
alter function internal.get_my_frontend_posting_allowance_v2(text) owner to postgres;
revoke all on function internal.get_my_frontend_posting_allowance_v2(text) from public;
grant execute on function internal.get_my_frontend_posting_allowance_v2(text) to authenticated;

commit;
