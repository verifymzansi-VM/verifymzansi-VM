-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_self_review_actor()
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=auth.uid();claims jsonb:=auth.jwt();
begin
  if actor is null or claims->>'role' is distinct from 'authenticated' or coalesce((claims->>'is_anonymous')::boolean,false)
    or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
      where u.id=actor and u.is_anonymous is false and u.email_confirmed_at is not null and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=clock_timestamp())
        and s.id::text=claims->>'session_id' and (s.not_after is null or s.not_after>clock_timestamp()))
    or exists(select 1 from private.account_closures c where c.user_id=actor)
    then raise exception 'live confirmed member session required' using errcode='42501';end if;
  return actor;
end$function$;
alter function internal.frontend_self_review_actor() owner to postgres;
revoke all on function internal.frontend_self_review_actor() from public;
