-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.purge_member_invitations(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  delete from private.member_invitations m where m.email in (
    select x.email from private.member_invitations x
    where coalesce(x.revoked_at, x.expires_at) < statement_timestamp() - interval '30 days'
    order by x.invited_at limit p_limit);
  get diagnostics n = row_count;
  return n;
end;
$function$;
alter function internal.purge_member_invitations(integer) owner to postgres;
revoke all on function internal.purge_member_invitations(integer) from public;
