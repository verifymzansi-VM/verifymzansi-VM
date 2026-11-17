-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_kept_record_subject(p_owner uuid, p_record uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_owner is not null then
    perform internal.lock_evidence_subject(p_owner);
  elsif p_record is null then
    raise exception 'record required' using errcode = '22023';
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('erased-record:' || p_record::text, 2408));
  end if;
end;
$function$;
alter function internal.lock_kept_record_subject(uuid,uuid) owner to postgres;
revoke all on function internal.lock_kept_record_subject(uuid,uuid) from public;
