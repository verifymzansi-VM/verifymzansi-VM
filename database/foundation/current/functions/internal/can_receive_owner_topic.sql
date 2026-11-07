-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.can_receive_owner_topic(p_topic text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=auth.uid(); claims jsonb:=auth.jwt();
begin
  return actor is not null and p_topic='owner:'||actor::text
    and claims->>'role'='authenticated' and not coalesce((claims->>'is_anonymous')::boolean,false)
    and exists(select 1 from private.current_account_access a where a.id=actor)
    and exists(select 1 from auth.sessions s where s.id::text=claims->>'session_id' and s.user_id=actor
      and (s.not_after is null or s.not_after>clock_timestamp()));
end;
$function$;
alter function internal.can_receive_owner_topic(text) owner to postgres;
revoke all on function internal.can_receive_owner_topic(text) from public;
grant execute on function internal.can_receive_owner_topic(text) to authenticated;
