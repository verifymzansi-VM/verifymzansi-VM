-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.account_closing_actor()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := auth.uid(); claims jsonb := auth.jwt(); signed_in_at bigint;
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean, false)
    or not exists (select 1 from auth.users u join auth.sessions s on s.user_id = u.id
      where u.id = actor and u.is_anonymous is false and u.deleted_at is null and u.email_confirmed_at is not null
        and s.id::text = claims->>'session_id' and (s.not_after is null or s.not_after > clock_timestamp())) then
    raise exception 'live confirmed member session required' using errcode = '42501';
  end if;
  select max((a->>'timestamp')::bigint) into signed_in_at
  from jsonb_array_elements(case when jsonb_typeof(claims->'amr') = 'array' then claims->'amr' else '[]'::jsonb end) a
  where jsonb_typeof(a) = 'object' and a->>'method' is not null and a->>'method' <> 'anonymous'
    and a->>'timestamp' ~ '^[0-9]{1,12}$';
  if signed_in_at is null or signed_in_at < extract(epoch from clock_timestamp() - interval '15 minutes') then
    raise exception 'sign in again to close the account' using errcode = '42501', detail = 'recent_sign_in_required';
  end if;
  if exists (select 1 from private.staff_roles r where r.user_id = actor and r.revoked_at is null) then
    raise exception 'a staff account is closed only after its roles end' using errcode = '42501',
      detail = 'staff_account';
  end if;
  return actor;
end;
$function$;
alter function internal.account_closing_actor() owner to postgres;
revoke all on function internal.account_closing_actor() from public;
