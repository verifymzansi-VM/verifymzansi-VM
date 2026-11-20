-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_member_invitations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform internal.staff_actor('member:invite');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'email', m.email,
        'invited_at', m.invited_at,
        'expires_at', m.expires_at,
        'revoked_at', m.revoked_at,
        'status', case when m.revoked_at is not null then 'revoked'
          when m.expires_at <= statement_timestamp() then 'expired' else 'open' end,
        'registered', exists (select 1 from auth.users u
          where u.email = m.email and u.deleted_at is null))
      order by m.invited_at desc, m.email)
    from (select * from private.member_invitations
      order by invited_at desc, email limit 500) m), '[]'::jsonb));
end;
$function$;
alter function internal.list_member_invitations() owner to postgres;
revoke all on function internal.list_member_invitations() from public;
grant execute on function internal.list_member_invitations() to authenticated;
