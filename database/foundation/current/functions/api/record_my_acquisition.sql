-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_my_acquisition(p_utm jsonb, p_partner_code text DEFAULT NULL::text, p_organisation_slug text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_campaign text DEFAULT NULL::text, p_landing_path text DEFAULT NULL::text, p_referrer_host text DEFAULT NULL::text, p_first_touch_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_my_acquisition(p_partner_code,p_organisation_slug,p_source,p_campaign,p_landing_path,
    p_referrer_host,p_utm,p_first_touch_at);
$function$;
alter function api.record_my_acquisition(jsonb,text,text,text,text,text,text,timestamp with time zone) owner to postgres;
revoke all on function api.record_my_acquisition(jsonb,text,text,text,text,text,text,timestamp with time zone) from public;
grant execute on function api.record_my_acquisition(jsonb,text,text,text,text,text,text,timestamp with time zone) to authenticated;
