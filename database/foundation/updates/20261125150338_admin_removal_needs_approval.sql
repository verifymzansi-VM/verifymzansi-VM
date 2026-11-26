-- Removing an admin needs another admin's approval (launch checklist item
-- 20). Until now an admin who lowered another admin's role (to governor,
-- moderator or member) applied it at once, so one admin, or one taken-over
-- admin account, could lock the others out; only the last active admin was
-- protected.
--
-- From this update internal.propose_frontend_staff_role (full body; its api
-- wrapper, arguments, result and grants are unchanged) applies a lowering at
-- once only when the person is a moderator or a governor. Lowering an admin
-- is recorded as a proposal (status "proposed", 7 days) that a different
-- admin approves or rejects through the existing api.review_frontend_staff_role:
-- never the proposer, never the admin it is about, and only while the
-- proposer is still an admin. Every other rule stays: nobody changes their
-- own role, a governor may only remove a moderator, promotions need an
-- independent approver, and only an owner-approved invitation makes an admin.
--
-- With only two admins a removal therefore waits for an approver who does not
-- exist and expires after 7 days. The emergency path is the owner's own
-- reviewed SQL session (updates/README.md, "Removing an admin needs another
-- admin's approval").
--
-- Expand only: one replaced body; no command, argument or grant changes.
-- ORDER: apply first, then merge. The live website's roles route already
-- accepts "proposed" as the answer to a proposal.
-- It refuses with 55000 unless the function has its reviewed body (or this
-- update's).
-- Read-only preflight: ../preflight/20261125150338_admin_removal_needs_approval.check.sql.
-- Rollback: ../rollback/20261125150338_admin_removal_needs_approval.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.propose_frontend_staff_role(text,text,text)');
  if body is null or body not in('d40ad40b7afce00a05ebf599a2953d25','e6d446d2702768234f979cdcaa20f281') then
    raise exception 'admin removal needs approval precondition: internal.propose_frontend_staff_role(text,text,text) is not a reviewed body (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

create or replace function internal.propose_frontend_staff_role(p_email text,p_role text,p_reason text)
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
  -- An admin lowers a moderator or a governor at once. Lowering another admin
  -- waits for a different admin's approval (review_frontend_staff_role), so
  -- one admin cannot lock out another.
  direct_removal:=actor_role='admin' and before_role<>'admin'
    and internal.frontend_staff_rank(p_role)<internal.frontend_staff_rank(before_role);
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
revoke all on function internal.propose_frontend_staff_role(text,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.propose_frontend_staff_role(text,text,text) to authenticated;
commit;
