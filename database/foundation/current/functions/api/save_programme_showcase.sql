-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_programme_showcase(p_org uuid, p_title text, p_placement text, p_enabled boolean, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_max_cards integer, p_display_order integer, p_sponsored_only boolean, p_reason text, p_showcase uuid DEFAULT NULL::uuid, p_expected_revision integer DEFAULT NULL::integer, p_province text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_programme uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_programme_showcase(p_org,p_showcase,p_expected_revision,p_title,p_placement,p_enabled,
    p_starts_at,p_ends_at,p_max_cards,p_display_order,p_sponsored_only,p_reason,p_province,p_city,p_programme);
$function$;
alter function api.save_programme_showcase(uuid,text,text,boolean,timestamp with time zone,timestamp with time zone,integer,integer,boolean,text,uuid,integer,text,text,uuid) owner to postgres;
revoke all on function api.save_programme_showcase(uuid,text,text,boolean,timestamp with time zone,timestamp with time zone,integer,integer,boolean,text,uuid,integer,text,text,uuid) from public;
grant execute on function api.save_programme_showcase(uuid,text,text,boolean,timestamp with time zone,timestamp with time zone,integer,integer,boolean,text,uuid,integer,text,text,uuid) to authenticated;
