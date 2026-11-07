-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_organisation_event(p_org uuid, p_actor uuid, p_action text, p_subject uuid, p_reason text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  insert into private.organisation_events(organisation_id,actor_id,action,subject_id,reason)
    values(p_org,p_actor,p_action,p_subject,p_reason);
$function$;
alter function internal.record_organisation_event(uuid,uuid,text,uuid,text) owner to postgres;
revoke all on function internal.record_organisation_event(uuid,uuid,text,uuid,text) from public;
