-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.revoke_member_invitation(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.staff_actor('member:invite');
  clean text := lower(btrim(p_email));
  revoked boolean;
begin
  if clean is null or char_length(clean) not between 3 and 254 then
    raise exception 'member_invitation_email_invalid' using errcode = '22023';
  end if;
  update private.member_invitations m set revoked_by = actor, revoked_at = statement_timestamp()
  where m.email = clean and m.revoked_at is null;
  revoked := found;
  if revoked then
    insert into private.member_invitation_events(email, action, actor_id)
      values (clean, 'revoke', actor);
  end if;
  return jsonb_build_object('email', clean, 'revoked', revoked);
end;
$function$;
alter function internal.revoke_member_invitation(text) owner to postgres;
revoke all on function internal.revoke_member_invitation(text) from public;
grant execute on function internal.revoke_member_invitation(text) to authenticated;
