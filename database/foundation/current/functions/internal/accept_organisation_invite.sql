-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.accept_organisation_invite(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); inv private.organisation_invites; o private.organisations; n integer; r text;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'this invitation link is no longer valid' using errcode='PT409',detail='invite_invalid'; end if;
  select * into inv from private.organisation_invites where token_hash=p_token_hash;
  if not found then
    raise exception 'this invitation link is no longer valid' using errcode='PT409',detail='invite_invalid'; end if;
  select * into o from private.organisations where id=inv.organisation_id for update;
  select * into inv from private.organisation_invites where id=inv.id for update;
  actor:=internal.price_draft_actor();
  if inv.revoked_at is not null or inv.accepted_at is not null or inv.expires_at<=statement_timestamp() then
    raise exception 'this invitation link is no longer valid' using errcode='PT409',detail='invite_invalid'; end if;
  if not exists(select 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null and lower(u.email)=inv.email) then
    raise exception 'sign in with the invited email address' using errcode='42501',detail='invite_email_mismatch'; end if;
  if internal.current_verified_identity(actor) is null then
    raise exception 'complete identity verification first' using errcode='42501',detail='verification_required'; end if;
  if o.programme_status in('suspended','ended') then
    raise exception 'this programme is not active' using errcode='PT409',detail='organisation_inactive'; end if;
  if not exists(select 1 from private.organisation_admins where organisation_id=o.id and account_id=actor) then
    select count(*) into n from private.organisation_admins where organisation_id=o.id;
    if n>=o.admin_limit then raise exception 'administrator limit reached' using errcode='PT409',detail='admin_limit'; end if;
    r:=case when n=0 then 'owner' else 'admin' end;
    insert into private.organisation_admins(organisation_id,account_id,role,added_by) values(o.id,actor,r,inv.invited_by);
  end if;
  update private.organisation_invites set accepted_at=statement_timestamp(),accepted_by=actor where id=inv.id;
  perform internal.record_organisation_event(o.id,actor,'admin_invite_accepted',inv.id,null);
  return jsonb_build_object('organisation_slug',o.slug,
    'role',(select a.role from private.organisation_admins a where a.organisation_id=o.id and a.account_id=actor));
end;
$function$;
alter function internal.accept_organisation_invite(text) owner to postgres;
revoke all on function internal.accept_organisation_invite(text) from public;
grant execute on function internal.accept_organisation_invite(text) to authenticated;
