-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.evidence_artifact_submission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare subject uuid; case_id uuid; c private.evidence_cases; relevant boolean;
begin
  subject:=case when tg_op='DELETE' then old.owner_id else new.owner_id end;
  case_id:=case when tg_op='DELETE' then old.case_id else new.case_id end;
  perform internal.lock_evidence_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=case_id and e.subject_id=subject for update;
  if not found then raise exception 'artifact subject must match case' using errcode='23514'; end if;
  if tg_op='INSERT' then
    relevant:=true;
    if c.status<>'open' or exists(select 1 from private.account_closures x where x.user_id=subject) then
      raise exception 'case no longer accepts evidence' using errcode='22023';
    end if;
  elsif tg_op='DELETE' then relevant:=true;
  else
    relevant:=(new.state,new.sha256,new.size_bytes) is distinct from (old.state,old.sha256,old.size_bytes)
      and not (c.status<>'open' and new.state in('cleanup_required','deleted')
        and (new.sha256,new.size_bytes) is not distinct from (old.sha256,old.size_bytes));
    if relevant and new.state in ('uploaded','clean','rejected') and
      (c.status<>'open' or exists(select 1 from private.account_closures x where x.user_id=subject)) then
      raise exception 'case no longer accepts evidence' using errcode='22023';
    end if;
  end if;
  if relevant then
    update private.evidence_cases set version=version+1 where id=c.id and version<2147483647;
    if not found then raise exception 'case revision exhausted' using errcode='22023'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
alter function internal.evidence_artifact_submission_guard() owner to postgres;
revoke all on function internal.evidence_artifact_submission_guard() from public;
