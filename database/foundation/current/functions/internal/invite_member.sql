-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invite_member(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.staff_actor('member:invite');
  clean text := lower(btrim(p_email));
  recent integer;
  invited timestamptz;
  expires timestamptz;
  added boolean;
begin
  if clean is null or char_length(clean) not between 3 and 254
    or clean !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+[.][^@[:space:][:cntrl:]]+$' then
    raise exception 'member_invitation_email_invalid' using errcode = '22023';
  end if;
  -- An address that already has an account needs no invitation (owner
  -- decision of 20 November 2026; staff may learn that it has one).
  if exists (select 1 from auth.users u where lower(u.email) = clean and u.deleted_at is null) then
    raise exception 'This person already has an account.' using errcode = 'PT409',
      detail = 'member_invitation_account_exists';
  end if;
  -- One invitation at a time per staff member, so the daily limit holds. It
  -- counts the staff member's own invitations and renewals, whoever's
  -- invitation row they touched.
  perform pg_advisory_xact_lock(hashtext('private.member_invitations:' || actor::text));
  select count(*) into recent from private.member_invitation_events e
  where e.actor_id = actor and e.action in ('invite', 'renew')
    and e.created_at > statement_timestamp() - interval '24 hours';
  if recent >= 200 then
    raise exception 'member_invitation_limit' using errcode = '54000';
  end if;
  insert into private.member_invitations as m (email, invited_by)
    values (clean, actor)
    on conflict (email) do update set invited_by = excluded.invited_by,
      invited_at = statement_timestamp(), expires_at = statement_timestamp() + interval '30 days',
      claimed_by = null, claimed_at = null, revoked_by = null, revoked_at = null
    returning m.invited_at, m.expires_at, (m.xmax = 0) into invited, expires, added;
  insert into private.member_invitation_events(email, action, actor_id)
    values (clean, case when added then 'invite' else 'renew' end, actor);
  return jsonb_build_object('email', clean, 'invited_at', invited, 'expires_at', expires);
end;
$function$;
alter function internal.invite_member(text) owner to postgres;
revoke all on function internal.invite_member(text) from public;
grant execute on function internal.invite_member(text) to authenticated;
