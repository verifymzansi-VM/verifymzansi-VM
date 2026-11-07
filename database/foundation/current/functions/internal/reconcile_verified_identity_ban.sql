-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reconcile_verified_identity_ban(p_decision uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare binding private.identity_ban_bindings; subject uuid;
begin
  select c.subject_id into subject from private.decisions d join private.evidence_cases c on c.id=d.case_id
    where d.id=p_decision and d.status='approved' and d.action='restrict_account';
  if not found then raise exception 'approved identity ban required' using errcode='42501'; end if;
  perform internal.lock_verification_subject(subject);
  select b.* into binding from private.identity_ban_bindings b where b.decision_id=p_decision;
  if not found then raise exception 'reviewed identity ban binding unavailable' using errcode='42501'; end if;
  return internal.record_identity_ban(binding.decision_id,binding.identity_hmac,binding.category);
end;
$function$;
alter function internal.reconcile_verified_identity_ban(uuid) owner to postgres;
revoke all on function internal.reconcile_verified_identity_ban(uuid) from public;
grant execute on function internal.reconcile_verified_identity_ban(uuid) to service_role;
