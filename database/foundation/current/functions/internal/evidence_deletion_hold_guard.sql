-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.evidence_deletion_hold_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare subject uuid;
begin
  if tg_table_name='legal_holds' then subject:=new.subject_id;
  else select c.subject_id into subject from private.evidence_cases c where c.id=new.case_id; end if;
  perform internal.lock_evidence_subject(subject);
  if exists(select 1 from private.evidence_artifacts a where a.owner_id=subject and a.state='cleanup_required') then
    raise exception 'evidence deletion is in progress; reconcile cleanup before placing a new hold' using errcode='PT409'; end if;
  return new;
end;
$function$;
alter function internal.evidence_deletion_hold_guard() owner to postgres;
revoke all on function internal.evidence_deletion_hold_guard() from public;
