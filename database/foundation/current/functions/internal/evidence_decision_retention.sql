-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.evidence_decision_retention()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  update private.evidence_artifacts
    set retain_until=least(coalesce(retain_until,'infinity'::timestamptz),statement_timestamp()+interval '30 days')
  where case_id=new.id and state in('uploaded','clean','rejected');
  return null;
end;
$function$;
alter function internal.evidence_decision_retention() owner to postgres;
revoke all on function internal.evidence_decision_retention() from public;
