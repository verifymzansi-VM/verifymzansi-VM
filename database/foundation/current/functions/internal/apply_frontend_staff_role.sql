-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.apply_frontend_staff_role(p_change private.frontend_staff_role_changes, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.apply_frontend_staff_role(private.frontend_staff_role_changes,uuid) owner to postgres;
revoke all on function internal.apply_frontend_staff_role(private.frontend_staff_role_changes,uuid) from public;
