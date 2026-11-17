-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.verification_evidence_invalidation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare subject uuid; case_id uuid; material boolean; changed integer;
begin
  subject:=case when tg_op='DELETE' then old.owner_id else new.owner_id end;
  case_id:=case when tg_op='DELETE' then old.case_id else new.case_id end;
  material:=tg_op<>'UPDATE';
  if tg_op='UPDATE' then
    material:=(new.state,new.sha256,new.size_bytes) is distinct from (old.state,old.sha256,old.size_bytes)
      and not (new.state in('cleanup_required','deleted')
        and (new.sha256,new.size_bytes) is not distinct from (old.sha256,old.size_bytes)
        and exists(select 1 from private.evidence_cases c where c.id=new.case_id and c.status<>'open'));
  end if;
  if material and exists(select 1 from private.evidence_cases c where c.id=case_id and c.kind='kyc') then
    perform internal.lock_verification_subject(subject);
    update private.accepted_identity_facts set revoked_at=clock_timestamp() where owner_id=subject and revoked_at is null;
    get diagnostics changed=row_count;
    if changed>0 and not exists(select 1 from private.account_closures x where x.user_id=subject) then
      if exists(select 1 from private.evidence_cases c where c.subject_id=subject and c.status='open' and c.kind in('kyc','business') and c.version=2147483647) then
        raise exception 'case revision exhausted' using errcode='22023'; end if;
      update private.evidence_cases set version=version+1 where subject_id=subject and status='open' and kind in('kyc','business');
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
alter function internal.verification_evidence_invalidation() owner to postgres;
revoke all on function internal.verification_evidence_invalidation() from public;
