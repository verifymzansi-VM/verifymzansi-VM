-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.signup_display_name(p_meta jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
declare candidate text;
begin
  -- Sign-up details are user-editable: they may suggest a display name and
  -- nothing else. The first candidate that passes the name rule wins.
  if jsonb_typeof(p_meta) is distinct from 'object' then return null; end if;
  foreach candidate in array array[
    case when jsonb_typeof(p_meta->'display_name')='string' then p_meta->>'display_name' end,
    case when jsonb_typeof(p_meta->'full_name')='string' then p_meta->>'full_name' end,
    case when jsonb_typeof(p_meta->'name')='string' then p_meta->>'name' end,
    case when jsonb_typeof(p_meta->'given_name')='string' and jsonb_typeof(p_meta->'family_name')='string'
        and btrim(p_meta->>'given_name')<>'' and btrim(p_meta->>'family_name')<>''
      then btrim(p_meta->>'given_name')||' '||btrim(p_meta->>'family_name') end]
  loop
    continue when candidate is null;
    candidate:=normalize(btrim(candidate),NFC);
    if internal.person_name_valid(candidate) and not internal.person_name_reserved(candidate) then
      return candidate; end if;
  end loop;
  return null;
end;
$function$;
alter function internal.signup_display_name(jsonb) owner to postgres;
revoke all on function internal.signup_display_name(jsonb) from public;
