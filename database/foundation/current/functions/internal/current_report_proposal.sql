-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.current_report_proposal(p_decision uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.frontend_report_proposals p join private.decisions d on d.id=p.decision_id
    where p.decision_id=p_decision and d.status='proposed' and p.expires_at>statement_timestamp());
$function$;
alter function internal.current_report_proposal(uuid) owner to postgres;
revoke all on function internal.current_report_proposal(uuid) from public;
