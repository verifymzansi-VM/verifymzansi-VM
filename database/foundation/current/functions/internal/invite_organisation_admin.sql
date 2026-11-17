-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invite_organisation_admin(p_org uuid, p_email text, p_token_hash text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage'); o private.organisations; inv private.organisation_invites;
begin
  perform internal.organisation_reason(p_reason);
  if not internal.enquiry_email_valid(p_email) or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invitation details are invalid' using errcode='22023',detail='invite_invalid'; end if;
  select * into o from private.organisations where id=p_org for update;
  if not found then raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable'; end if;
  actor:=internal.staff_actor('organisation:manage');
  if o.programme_status in('suspended','ended') then
    raise exception 'this programme is not active' using errcode='PT409',detail='organisation_inactive'; end if;
  if exists(select 1 from private.organisation_admins a join auth.users u on u.id=a.account_id
      where a.organisation_id=o.id and lower(u.email)=p_email) then
    raise exception 'already an administrator' using errcode='PT409',detail='admin_exists'; end if;
  update private.organisation_invites set revoked_at=statement_timestamp(),revoked_by=actor
    where organisation_id=o.id and email=p_email and accepted_at is null and revoked_at is null;
  if (select count(*) from private.organisation_admins where organisation_id=o.id)
    +(select count(*) from private.organisation_invites where organisation_id=o.id and accepted_at is null
        and revoked_at is null and expires_at>statement_timestamp())>=o.admin_limit then
    raise exception 'administrator limit reached' using errcode='PT409',detail='admin_limit'; end if;
  begin
    insert into private.organisation_invites(organisation_id,email,token_hash,invited_by,expires_at)
      values(o.id,p_email,p_token_hash,actor,statement_timestamp()+interval '7 days') returning * into inv;
  exception when unique_violation then
    raise exception 'invitation details are invalid' using errcode='22023',detail='invite_invalid';
  end;
  perform internal.record_organisation_event(o.id,actor,'admin_invited',inv.id,p_reason);
  return jsonb_build_object('invite_id',inv.id,'expires_at',inv.expires_at,'organisation_name',o.name);
end;
$function$;
alter function internal.invite_organisation_admin(uuid,text,text,text) owner to postgres;
revoke all on function internal.invite_organisation_admin(uuid,text,text,text) from public;
grant execute on function internal.invite_organisation_admin(uuid,text,text,text) to authenticated;
