-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_evidence_subject(p_subject uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_subject is null then raise exception 'evidence subject required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_subject::text,2408));
end;
$function$;
alter function internal.lock_evidence_subject(uuid) owner to postgres;
revoke all on function internal.lock_evidence_subject(uuid) from public;
