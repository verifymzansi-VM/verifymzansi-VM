-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_submission_replaced()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  update private.evidence_artifacts a
    set retain_until=least(coalesce(a.retain_until,'infinity'::timestamptz),statement_timestamp()+interval '5 days')
    from private.verification_identity_submissions s
    where s.id=old.submission_id and a.id in(s.id_artifact_id,s.selfie_artifact_id)
      and a.state in('uploaded','clean','rejected');
  return null;
end$function$;
alter function internal.identity_submission_replaced() owner to postgres;
revoke all on function internal.identity_submission_replaced() from public;
