-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_cipc_legal_name_match(p_owner uuid, p_copy jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.profiles p where p.account_id=p_owner and p.legal_first_name is not null
    and p.legal_last_name is not null and (select count(*) from jsonb_array_elements(coalesce(p_copy->'directors','[]'::jsonb)) j
      where regexp_replace(lower(j->>'name'),'[^[:alnum:]]','','g')=
        regexp_replace(lower(concat_ws(' ',p.legal_first_name,p.legal_last_name)),'[^[:alnum:]]','','g'))=1);
$function$;
alter function internal.frontend_cipc_legal_name_match(uuid,jsonb) owner to postgres;
revoke all on function internal.frontend_cipc_legal_name_match(uuid,jsonb) from public;
