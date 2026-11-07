-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.release_evidence_claim(p_case uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('case:claim'); c private.evidence_cases;
begin
  select e.* into c from private.evidence_cases e where e.id=p_case for update;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null where id=c.id;
  return true;
end;
$function$;
alter function internal.release_evidence_claim(uuid,text,uuid) owner to postgres;
revoke all on function internal.release_evidence_claim(uuid,text,uuid) from public;
grant execute on function internal.release_evidence_claim(uuid,text,uuid) to authenticated;
