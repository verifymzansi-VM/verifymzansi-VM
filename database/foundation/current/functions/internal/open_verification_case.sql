-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.open_verification_case()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); c private.evidence_cases;
begin
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  select e.* into c from private.accepted_identity_facts f join private.verification_identity_submissions s on s.id=f.submission_id
    join private.evidence_cases e on e.id=s.case_id where f.owner_id=actor order by f.reviewed_at desc,f.id desc limit 1;
  if found then return jsonb_build_object('case_id',c.id,'version',c.version,'status','accepted','read_only',true); end if;
  select e.* into c from private.evidence_cases e where e.subject_id=actor and e.kind='kyc' and e.status='open' order by e.created_at desc,e.id limit 1;
  if not found then insert into private.evidence_cases(subject_id,kind) values(actor,'kyc') returning * into c; end if;
  return jsonb_build_object('case_id',c.id,'version',c.version,'status','open','read_only',exists(
    select 1 from private.decisions d where d.case_id=c.id and d.status='proposed' and d.action='approve_override' and d.payload ? 'identity_submission_id'));
end;
$function$;
alter function internal.open_verification_case() owner to postgres;
revoke all on function internal.open_verification_case() from public;
grant execute on function internal.open_verification_case() to authenticated;
