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
  entry private.member_invitations;
begin
  if clean is null or char_length(clean) not between 3 and 254
    or clean !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+[.][^@[:space:][:cntrl:]]+$' then
    raise exception 'member_invitation_email_invalid' using errcode = '22023';
  end if;
  -- One invitation at a time per staff member, so the daily limit holds.
  perform pg_advisory_xact_lock(hashtext('private.member_invitations:' || actor::text));
  select count(*) into recent from private.member_invitations m
  where m.invited_by = actor and m.invited_at > statement_timestamp() - interval '24 hours';
  if recent >= 200 then
    raise exception 'member_invitation_limit' using errcode = '54000';
  end if;
  insert into private.member_invitations as m (email, invited_by)
    values (clean, actor)
    on conflict (email) do update set invited_by = excluded.invited_by,
      invited_at = statement_timestamp(), expires_at = statement_timestamp() + interval '30 days',
      revoked_by = null, revoked_at = null
    returning m.* into entry;
  return jsonb_build_object('email', entry.email, 'invited_at', entry.invited_at,
    'expires_at', entry.expires_at);
end;
$function$;
alter function internal.invite_member(text) owner to postgres;
revoke all on function internal.invite_member(text) from public;
grant execute on function internal.invite_member(text) to authenticated;
