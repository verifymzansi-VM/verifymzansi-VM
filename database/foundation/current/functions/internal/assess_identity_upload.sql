-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assess_identity_upload(p_owner uuid, p_fingerprint text, p_document_sha256 text, p_selfie_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare risk integer:=0; blocked boolean;
begin
  if p_owner is null or p_fingerprint !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
    or p_document_sha256 !~ '^[a-f0-9]{64}$' or p_selfie_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'bounded processing receipt required' using errcode='22023'; end if;
  blocked:=exists(select 1 from private.banned_identities b where b.identity_hmac=p_fingerprint and b.retain_until>clock_timestamp());
  if exists(select 1 from private.accepted_identity_facts f where f.owner_id<>p_owner and f.identity_hmac=p_fingerprint and f.revoked_at is null)
    or exists(select 1 from private.evidence_artifacts a where a.owner_id<>p_owner and a.content_sha256 in(p_document_sha256,p_selfie_sha256) and a.state in('clean','uploaded')) then risk:=75; end if;
  if (select count(*) from private.verification_identity_submissions s where s.owner_id=p_owner and s.created_at>clock_timestamp()-interval '24 hours')>=3 then risk:=greatest(risk,80); end if;
  return jsonb_build_object('blocked',blocked,'risk_score',risk);
end;
$function$;
alter function internal.assess_identity_upload(uuid,text,text,text) owner to postgres;
revoke all on function internal.assess_identity_upload(uuid,text,text,text) from public;
grant execute on function internal.assess_identity_upload(uuid,text,text,text) to service_role;
