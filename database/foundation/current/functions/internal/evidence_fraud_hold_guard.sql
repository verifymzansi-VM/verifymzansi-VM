-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.evidence_fraud_hold_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.case_id,new.reason,new.placed_by,new.placed_at)
      is distinct from (old.id,old.case_id,old.reason,old.placed_by,old.placed_at)
    or old.closed_at is not null or new.closed_at is null then
    raise exception 'fraud holds are immutable except their first closure' using errcode='23514'; end if;
  return new;
end;
$function$;
alter function internal.evidence_fraud_hold_guard() owner to postgres;
revoke all on function internal.evidence_fraud_hold_guard() from public;
