-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_verification_case()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); c private.evidence_cases; fact text; submission uuid; reason text;
begin
  fact:=internal.current_verified_identity(actor);
  select e.* into c from private.evidence_cases e where e.subject_id=actor and e.kind='kyc'
    order by e.created_at desc,e.id limit 1;
  select v.submission_id into submission from private.verification_current_submissions v
    join private.verification_identity_submissions s on s.id=v.submission_id
    where v.case_id=c.id and s.case_version=c.version;
  select r.reason into reason from private.verification_return_requests r where r.case_id=c.id and r.case_version=c.version
    order by r.created_at desc,r.id limit 1;
  return jsonb_build_object('case_id',c.id,'version',c.version,'verified',fact is not null,
    'phone_verified',exists(select 1 from private.verification_phone_proofs p where p.owner_id=actor and p.revoked_at is null),
    'locality_confirmed',exists(select 1 from private.verification_localities l where l.owner_id=actor),
    'submission_pending',submission is not null and fact is null,'return_reason',reason);
end;
$function$;
alter function internal.get_my_verification_case() owner to postgres;
revoke all on function internal.get_my_verification_case() from public;
grant execute on function internal.get_my_verification_case() to authenticated;
