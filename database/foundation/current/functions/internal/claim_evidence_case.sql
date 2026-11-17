-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_evidence_case(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('case:claim'); c private.evidence_cases; subject uuid;
begin
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case_id;
  if not found then raise exception 'case not open' using errcode='22023'; end if;
  perform internal.lock_evidence_subject(subject);
  select * into c from private.evidence_cases e where e.id = p_case_id and e.status = 'open' for update;
  if not found then raise exception 'case not open' using errcode = '22023'; end if;
  actor:=internal.staff_actor('case:claim');
  if c.kind='business' and exists(select 1 from private.frontend_business_checks x where x.id=c.id and x.kind='seen' and x.status<>'pending') then
    raise exception 'seen check is not ready for a claim' using errcode='PT409';end if;
  if c.kind='business' and exists(select 1 from private.frontend_business_checks x where x.id=c.id and x.kind='seen'
    and x.assigned_to is not null and x.assigned_to<>actor and x.visit_report is null) then
    perform internal.staff_actor('decision:approve');end if;
  if c.kind='business' and exists(select 1 from private.frontend_cipc_reviews d join private.frontend_business_checks x on x.id=d.check_id
    where d.check_id=c.id and (d.submitted_at is null or x.status<>'pending')) then
    raise exception 'CIPC case is not ready for a claim' using errcode='PT409';end if;
  if c.subject_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  if c.claimed_by is not null and c.claimed_by <> actor and c.claim_expires_at > clock_timestamp() then
    raise exception 'case claimed by another reviewer' using errcode = 'PT409';
  end if;
  update private.evidence_cases set claimed_by = actor, claim_expires_at = clock_timestamp() + interval '30 minutes',
    claim_generation=claim_generation+1,claim_nonce=pg_catalog.gen_random_uuid()
  where id = c.id and claim_generation<9223372036854775807 returning * into c;
  if not found then raise exception 'claim generation exhausted' using errcode='PT409'; end if;
  return jsonb_build_object('case_id', c.id, 'version', c.version,'claim_generation',c.claim_generation::text,
    'claim_nonce',c.claim_nonce,'claim_expires_at', c.claim_expires_at);
end;
$function$;
alter function internal.claim_evidence_case(uuid) owner to postgres;
revoke all on function internal.claim_evidence_case(uuid) from public;
grant execute on function internal.claim_evidence_case(uuid) to authenticated;
