-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_actor_recent(p_capability text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor(p_capability);claims jsonb:=auth.jwt();totp_at bigint;
begin
  select max((a->>'timestamp')::bigint) into totp_at
  from jsonb_array_elements(case when jsonb_typeof(claims->'amr')='array' then claims->'amr' else '[]' end) a
  where jsonb_typeof(a)='object' and a->>'method'='totp' and a->>'timestamp' ~ '^[0-9]{1,12}$';
  if totp_at is null or totp_at<extract(epoch from clock_timestamp()-interval '15 minutes') then
    raise exception 'recent second-factor verification required' using errcode='42501';
  end if;
  return actor;
end$function$;
alter function internal.staff_actor_recent(text) owner to postgres;
revoke all on function internal.staff_actor_recent(text) from public;
grant execute on function internal.staff_actor_recent(text) to authenticated;
