-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_frontend_support_mail(p_ticket uuid, p_template text, p_accepted boolean)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.record_frontend_support_mail(p_ticket,p_template,p_accepted)$function$;
alter function api.record_frontend_support_mail(uuid,text,boolean) owner to postgres;
revoke all on function api.record_frontend_support_mail(uuid,text,boolean) from public;
grant execute on function api.record_frontend_support_mail(uuid,text,boolean) to service_role;
