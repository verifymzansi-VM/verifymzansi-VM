-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.review_frontend_staff_role(p_decision uuid, p_action text, p_version integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.review_frontend_staff_role(uuid,text,integer,text) owner to postgres;
revoke all on function internal.review_frontend_staff_role(uuid,text,integer,text) from public;
grant execute on function internal.review_frontend_staff_role(uuid,text,integer,text) to authenticated;
