-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.price_draft_actor()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=auth.uid(); claims jsonb:=auth.jwt();
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean,false)
    or not exists(select 1 from private.current_account_access u where u.id=actor) then
    raise exception 'active authenticated member required' using errcode='42501';
  end if;
  if not exists(select 1 from auth.sessions s where s.id::text=claims->>'session_id'
    and s.user_id=actor and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'live session required' using errcode='42501';
  end if;
  return actor;
end;
$function$;
alter function internal.price_draft_actor() owner to postgres;
revoke all on function internal.price_draft_actor() from public;
grant execute on function internal.price_draft_actor() to authenticated;
