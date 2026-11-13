-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_my_communication_choices(p_wording text, p_marketing_email boolean DEFAULT NULL::boolean, p_marketing_sms boolean DEFAULT NULL::boolean, p_analytics boolean DEFAULT NULL::boolean, p_third_party_sharing boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_my_communication_choices(p_wording, p_marketing_email, p_marketing_sms, p_analytics, p_third_party_sharing);
$function$;
alter function api.save_my_communication_choices(text,boolean,boolean,boolean,boolean) owner to postgres;
revoke all on function api.save_my_communication_choices(text,boolean,boolean,boolean,boolean) from public;
grant execute on function api.save_my_communication_choices(text,boolean,boolean,boolean,boolean) to authenticated;
