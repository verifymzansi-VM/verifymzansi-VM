-- The selected enforcement screen reads canonical restrictions without
-- disclosing reporter identities or giving the browser private table access.
begin;
create function internal.get_frontend_enforcement()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('account:restore');now_at timestamptz:=clock_timestamp();result jsonb;
begin
  with active as materialized (
    select x.id,x.decision_id,x.account_id,x.kind,x.reason,x.starts_at,x.ends_at,x.emergency,x.version,
      coalesce(actor in(x.account_id,x.reporter_id,d.proposed_by,d.approved_by),false) as conflicted,p.display_name
      from private.frontend_account_restrictions x join private.decisions d on d.id=x.decision_id
      left join private.profiles p on p.account_id=x.account_id
      where x.lifted_at is null and (x.ends_at is null or x.ends_at>now_at)
    union all
    select d.id,d.id,c.subject_id,'ban','Account restricted after an independent review.',d.approved_at,null,false,null,true,p.display_name
      from private.decisions d join private.evidence_cases c on c.id=d.case_id
      left join private.profiles p on p.account_id=c.subject_id
      where d.action='restrict_account' and d.scope_kind='native' and d.status='approved'
  ), history as (
    select a.id::text id,a.action,r.subject_account_id account_id,a.reason,a.created_at
      from private.frontend_report_action_receipts a join private.reports r on r.id=a.report_id where a.action in('warn','hide') and a.status='applied'
    union all
    select 'restriction:'||x.id,case when x.emergency then 'emergency suspension' else x.kind end,x.account_id,x.reason,x.starts_at
      from private.frontend_account_restrictions x
    union all
    select 'lift:'||x.id,'lift',x.account_id,x.lift_reason,x.lifted_at
      from private.frontend_account_restrictions x where x.lifted_at is not null
    union all
    select 'restriction:'||d.id,'ban',c.subject_id,'Account restricted after an independent review.',d.approved_at
      from private.decisions d join private.evidence_cases c on c.id=d.case_id
      where d.action='restrict_account' and d.scope_kind='native' and d.status='approved'
  ) select jsonb_build_object('actor_id',actor,
    'total',(select count(*) from active),
    'suspensions',(select count(*) from active where kind='suspension'),
    'bans',(select count(*) from active where kind='ban'),
    'emergency',(select count(*) from active where emergency),
    'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc,x.id desc) from
      (select * from active order by starts_at desc,id desc limit 50)x),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from
      (select * from history order by created_at desc,id desc limit 20)x),'[]'::jsonb)
  ) into result;
  perform internal.staff_actor('account:restore');return result;
end$$;
revoke all on function internal.get_frontend_enforcement() from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_enforcement() to authenticated;
create function api.get_frontend_enforcement()
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_enforcement()$$;
revoke all on function api.get_frontend_enforcement() from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_enforcement() to authenticated;

-- A narrow session check for restriction status and later self-only appeals.
-- It cannot authorize an active-account command or select another account.
create function internal.frontend_self_review_actor()
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();claims jsonb:=auth.jwt();
begin
  if actor is null or claims->>'role' is distinct from 'authenticated' or coalesce((claims->>'is_anonymous')::boolean,false)
    or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=actor and u.is_anonymous is false and u.email_confirmed_at is not null and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=clock_timestamp())
        and s.id::text=claims->>'session_id' and (s.not_after is null or s.not_after>clock_timestamp()))
    or exists(select 1 from private.account_closures c where c.user_id=actor)
    then raise exception 'live confirmed member session required' using errcode='42501';end if;
  return actor;
end$$;
revoke all on function internal.frontend_self_review_actor() from public,anon,authenticated,service_role;

create function internal.get_my_frontend_restriction_status()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.frontend_self_review_actor();now_at timestamptz:=clock_timestamp();ends timestamptz;result_status text;
begin
  if exists(select 1 from private.current_account_access where id=actor) then result_status:='active';
  elsif exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
    where c.subject_id=actor and d.status='approved' and d.action='restrict_account' and d.scope_kind='native')
    or exists(select 1 from private.frontend_account_restrictions x where x.account_id=actor and x.kind='ban' and x.lifted_at is null)
    then result_status:='banned';
  else
    select max(x.ends_at) into ends from private.frontend_account_restrictions x where x.account_id=actor and x.kind='suspension'
      and x.lifted_at is null and x.ends_at>now_at;
    if ends is null then raise exception 'current restriction unavailable' using errcode='42501';end if;
    result_status:='suspended';
  end if;
  return jsonb_build_object('account_id',actor,'status',result_status,'ends_at',ends);
end$$;
revoke all on function internal.get_my_frontend_restriction_status() from public,anon,authenticated,service_role;
grant execute on function internal.get_my_frontend_restriction_status() to authenticated;
create function api.get_my_frontend_restriction_status()
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_my_frontend_restriction_status()$$;
revoke all on function api.get_my_frontend_restriction_status() from public,anon,authenticated,service_role;
grant execute on function api.get_my_frontend_restriction_status() to authenticated;
notify pgrst,'reload schema';
commit;
