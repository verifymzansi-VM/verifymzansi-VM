-- Independent staff-role review on the canonical roster. The owner's
-- approved full-administrator invitations remain the only admin candidates.
begin;
insert into private.staff_capabilities(role,capability,requires_recent_mfa) values
  ('admin','role:review',true),('governor','role:review',true);
alter table private.staff_roles add column frontend_mfa_not_before timestamptz;
do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.staff_actor(text)'::regprocedure;
  if md5(body)<>'066a636e9d98fb4aa70c269be485ac2b' then raise exception 'staff authority drift';end if;
  changed:=replace(body,'  totp_at bigint;','  totp_at bigint; proof_after timestamptz;');
  changed:=replace(changed,'select c.requires_recent_mfa into needs_mfa','select c.requires_recent_mfa,r.frontend_mfa_not_before into needs_mfa,proof_after');
  changed:=replace(changed,'  if needs_mfa and','  if proof_after is not null and totp_at<ceil(extract(epoch from proof_after)) then
    raise exception ''second-factor verification required after role assignment'' using errcode=''42501'';end if;
  if needs_mfa and');
  if changed=body or position('frontend_mfa_not_before' in changed)=0 then raise exception 'role proof anchor missing';end if;
  execute format('create or replace function internal.staff_actor(p_capability text) returns uuid language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;

create table private.frontend_staff_role_changes(
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references auth.users(id) on delete cascade,
  prior_assignment_id uuid references private.staff_roles(id) on delete set null,
  from_role text not null check(from_role in('member','moderator','governor','admin')),
  to_role text not null check(to_role in('member','moderator','governor','admin') and to_role<>from_role),
  proposer_id uuid references auth.users(id) on delete set null,
  reviewer_id uuid references auth.users(id) on delete set null,
  reason text not null check(length(reason) between 5 and 500),
  note text check(length(note) between 1 and 500),
  status text not null default 'proposed' check(status in('proposed','applied','rejected','withdrawn')),
  direct_removal boolean not null default false check(not direct_removal or status='applied'),
  created_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>created_at),
  decided_at timestamptz,
  check((status='proposed')=(decided_at is null))
);
create unique index frontend_staff_role_changes_pending_idx on private.frontend_staff_role_changes(target_id) where status='proposed';
create index frontend_staff_role_changes_history_idx on private.frontend_staff_role_changes(decided_at desc,id desc) where status='applied';
create index frontend_staff_role_changes_target_idx on private.frontend_staff_role_changes(target_id);
create index frontend_staff_role_changes_proposer_idx on private.frontend_staff_role_changes(proposer_id);
create index frontend_staff_role_changes_reviewer_idx on private.frontend_staff_role_changes(reviewer_id);
create index frontend_staff_role_changes_assignment_idx on private.frontend_staff_role_changes(prior_assignment_id);
alter table private.frontend_staff_role_changes enable row level security;
revoke all on private.frontend_staff_role_changes from public,anon,authenticated,service_role;

create function internal.frontend_staff_rank(p_role text)
returns integer language sql immutable security invoker set search_path=pg_catalog as $$
  select case p_role when 'member' then 0 when 'moderator' then 1 when 'governor' then 2 when 'admin' then 3 end;
$$;
revoke all on function internal.frontend_staff_rank(text) from public,anon,authenticated,service_role;

create function internal.apply_frontend_staff_role(p_change private.frontend_staff_role_changes,p_actor uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare current_assignment private.staff_roles;now_at timestamptz:=clock_timestamp();
begin
  select * into current_assignment from private.staff_roles where user_id=p_change.target_id and revoked_at is null;
  if current_assignment.id is distinct from p_change.prior_assignment_id or coalesce(current_assignment.role,'member')<>p_change.from_role
    then raise exception 'the current staff role changed' using errcode='PT409';end if;
  if p_change.to_role='admin' and not exists(select 1 from private.owner_admin_invitations i where i.claimed_by=p_change.target_id and i.revoked_at is null)
    then raise exception 'owner-approved administrator invitation required' using errcode='42501';end if;
  if p_change.to_role<>'member' and not exists(select 1 from private.current_account_access u where u.id=p_change.target_id)
    then raise exception 'the account cannot receive a staff role' using errcode='PT409';end if;
  if current_assignment.id is not null then
    update private.staff_roles set revoked_at=now_at,revoked_by=p_actor where id=current_assignment.id;
  end if;
  if p_change.to_role<>'member' then
    insert into private.staff_roles(user_id,role,granted_at,granted_by,frontend_mfa_not_before)
      values(p_change.target_id,p_change.to_role,now_at,p_actor,now_at);
  end if;
end$$;
revoke all on function internal.apply_frontend_staff_role(private.frontend_staff_role_changes,uuid) from public,anon,authenticated,service_role;

create function internal.propose_frontend_staff_role(p_email text,p_role text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('role:review');actor_role text;target uuid;reason_text text;
  assignment private.staff_roles;change_row private.frontend_staff_role_changes;before_role text;now_at timestamptz;direct_removal boolean;
begin
  if p_role is null or internal.frontend_staff_rank(p_role) is null or p_email is null or length(p_email)>254
    then raise exception 'valid account and role required' using errcode='22023';end if;
  reason_text:=internal.privacy_text(p_reason,5,500);
  select u.id into target from auth.users u where lower(u.email)=lower(btrim(p_email))
    and u.email_confirmed_at is not null and u.deleted_at is null and not u.is_anonymous;
  if target is null then raise exception 'confirmed account not found' using errcode='PT404';end if;
  if target=actor then raise exception 'staff cannot change their own role' using errcode='42501';end if;
  perform internal.lock_verification_subject(target);
  lock table private.staff_roles in share row exclusive mode;
  actor:=internal.staff_actor('role:review');now_at:=clock_timestamp();
  if not exists(select 1 from auth.users u where u.id=target and lower(u.email)=lower(btrim(p_email))
    and u.email_confirmed_at is not null and u.deleted_at is null and not u.is_anonymous)
    then raise exception 'confirmed account not found' using errcode='PT404';end if;
  select role into actor_role from private.staff_roles where user_id=actor and revoked_at is null;
  select * into assignment from private.staff_roles where user_id=target and revoked_at is null;
  before_role:=coalesce(assignment.role,'member');
  if before_role=p_role then raise exception 'account already has this role' using errcode='PT409';end if;
  if p_role='admin' and not exists(select 1 from private.owner_admin_invitations i where i.claimed_by=target and i.revoked_at is null)
    then raise exception 'owner-approved administrator invitation required' using errcode='42501';end if;
  if actor_role<>'admin' and not(actor_role='governor' and before_role='moderator' and p_role='member')
    then raise exception 'staff role change not authorized' using errcode='42501';end if;
  direct_removal:=actor_role='admin' and internal.frontend_staff_rank(p_role)<internal.frontend_staff_rank(before_role);
  update private.frontend_staff_role_changes set status='withdrawn',decided_at=now_at,note='Expired before another proposal'
    where target_id=target and status='proposed' and expires_at<=now_at;
  if direct_removal then
    update private.frontend_staff_role_changes set status='withdrawn',decided_at=now_at,note='Superseded by the current removal'
      where target_id=target and status='proposed';
  elsif exists(select 1 from private.frontend_staff_role_changes where target_id=target and status='proposed') then
    raise exception 'a role change is already pending' using errcode='PT409';
  end if;
  insert into private.frontend_staff_role_changes(target_id,prior_assignment_id,from_role,to_role,proposer_id,reviewer_id,reason,status,direct_removal,created_at,expires_at,decided_at)
    values(target,assignment.id,before_role,p_role,actor,case when direct_removal then actor end,reason_text,
      case when direct_removal then 'applied' else 'proposed' end,direct_removal,now_at,now_at+interval '7 days',case when direct_removal then now_at end)
    returning * into change_row;
  if direct_removal then perform internal.apply_frontend_staff_role(change_row,actor);end if;
  perform internal.staff_actor('role:review');
  return jsonb_build_object('id',change_row.id,'status',change_row.status);
end$$;
create function api.propose_frontend_staff_role(p_email text,p_role text,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.propose_frontend_staff_role(p_email,p_role,p_reason)$$;

create function internal.review_frontend_staff_role(p_decision uuid,p_action text,p_version integer default null,p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('role:review');actor_role text;proposer_role text;target uuid;note_text text;result_status text;
  x private.frontend_staff_role_changes;now_at timestamptz;
begin
  if p_action is null or p_action not in('approve','reject') or (p_action='approve' and p_version is distinct from 1)
    then raise exception 'represented role decision required' using errcode='22023';end if;
  if nullif(btrim(p_note),'') is not null then note_text:=internal.privacy_text(p_note,1,500);end if;
  select target_id into target from private.frontend_staff_role_changes where id=p_decision;
  if target is null then raise exception 'staff role change unavailable' using errcode='PT404';end if;
  perform internal.lock_verification_subject(target);
  lock table private.staff_roles in share row exclusive mode;
  select * into x from private.frontend_staff_role_changes where id=p_decision for update;
  actor:=internal.staff_actor('role:review');now_at:=clock_timestamp();
  if x.status<>'proposed' or x.expires_at<=now_at then raise exception 'staff role decision changed or expired' using errcode='PT409';end if;
  if actor=target or (actor=x.proposer_id and p_action='approve') then raise exception 'independent staff role reviewer required' using errcode='42501';end if;
  select role into actor_role from private.staff_roles where user_id=actor and revoked_at is null;
  if p_action='reject' and actor=x.proposer_id then result_status:='withdrawn';
  else
    if actor_role<>'admin' and not(actor_role='governor' and x.from_role='member' and x.to_role='moderator')
      then raise exception 'staff role review not authorized' using errcode='42501';end if;
    if p_action='approve' then
      select r.role into proposer_role from private.staff_roles r join private.current_account_access a on a.id=r.user_id
        where r.user_id=x.proposer_id and r.revoked_at is null;
      if proposer_role is distinct from 'admin' and not(coalesce(proposer_role='governor',false) and x.from_role='moderator' and x.to_role='member')
        then raise exception 'the proposer no longer has authority' using errcode='PT409';end if;
      perform internal.apply_frontend_staff_role(x,actor);result_status:='applied';
    else result_status:='rejected';end if;
  end if;
  update private.frontend_staff_role_changes set status=result_status,reviewer_id=actor,note=note_text,decided_at=now_at where id=x.id;
  perform internal.staff_actor('role:review');
  return jsonb_build_object('id',x.id,'status',result_status);
end$$;
create function api.review_frontend_staff_role(p_decision uuid,p_action text,p_version integer default null,p_note text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.review_frontend_staff_role(p_decision,p_action,p_version,p_note)$$;

create function internal.get_frontend_staff_role_review(p_page integer default 1,p_role text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('role:review');now_at timestamptz:=clock_timestamp();result jsonb;
begin
  if p_page is null or p_page not between 1 and 10000 or (p_role is not null and p_role not in('moderator','governor','admin'))
    then raise exception 'valid roster page required' using errcode='22023';end if;
  with roster as (
    select r.user_id,r.role,r.granted_at,r.frontend_mfa_not_before as mfa_required_after
    from private.staff_roles r where r.revoked_at is null and (p_role is null or r.role=p_role)
  ), staff as (
    select * from roster order by granted_at desc,user_id limit 50 offset (p_page-1)*50
  ), pending as (
    select id,target_id,from_role,to_role,proposer_id,reason,created_at,expires_at
      from private.frontend_staff_role_changes where status='proposed' and expires_at>now_at order by created_at,id limit 100
  ), history as (
    select id,target_id,from_role,to_role,reviewer_id,reason,decided_at
      from private.frontend_staff_role_changes where status='applied' order by decided_at desc,id desc limit 25
  ), involved as (
    select user_id from staff union select target_id from pending union select proposer_id from pending
      union select target_id from history union select reviewer_id from history
  )
  select jsonb_build_object('actor_id',actor,'staff_total',(select count(*) from roster),
    'staff',coalesce((select jsonb_agg(to_jsonb(s) order by granted_at desc,user_id) from staff s),'[]'::jsonb),
    'pending',coalesce((select jsonb_agg(to_jsonb(p) order by created_at,id) from pending p),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by decided_at desc,id desc) from history h),'[]'::jsonb),
    'people',coalesce((select jsonb_agg(jsonb_build_object('user_id',u.id,'email',u.email,'display_name',p.display_name))
      from involved i join auth.users u on u.id=i.user_id and u.deleted_at is null left join private.profiles p on p.account_id=u.id),'[]'::jsonb)
  ) into result;
  perform internal.staff_actor('role:review');return result;
end$$;
create function api.get_frontend_staff_role_review(p_page integer default 1,p_role text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_staff_role_review(p_page,p_role)$$;

do $$declare signature text;ns text;begin
  foreach signature in array array['propose_frontend_staff_role(text,text,text)','review_frontend_staff_role(uuid,text,integer,text)','get_frontend_staff_role_review(integer,text)'] loop
    foreach ns in array array['api','internal'] loop
      execute format('revoke all on function %I.%s from public,anon,authenticated,service_role',ns,signature);
      execute format('grant execute on function %I.%s to authenticated',ns,signature);
    end loop;
  end loop;
end$$;
do $$declare body text;begin
  body:=replace(pg_get_viewdef('private.frontend_staff_audit_events'::regclass,true),E'\r\n',E'\n');
  if md5(body)<>'6e1c831aa88d997fcaa604924bb23dec' then raise exception 'role audit view drift';end if;
  execute 'create or replace view private.frontend_staff_audit_events with(security_invoker=true) as '||rtrim(body,E';\n ')||$events$
    union all select 'staff_role_proposal:'||x.id,x.created_at,x.proposer_id,x.target_id,'account','staff_role:proposed',x.reason
      from private.frontend_staff_role_changes x where not x.direct_removal
    union all select 'staff_role_outcome:'||x.id,x.decided_at,x.reviewer_id,x.target_id,'account','staff_role:'||x.status,coalesce(x.note,x.reason)
      from private.frontend_staff_role_changes x where x.status<>'proposed'
  $events$;
end$$;
revoke all on private.frontend_staff_audit_events from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
