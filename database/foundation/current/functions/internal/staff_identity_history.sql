-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_identity_history(p_owner uuid, p_before_time timestamp with time zone, p_before_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('decision:propose'); c private.evidence_cases;
  items jsonb; more boolean; ids uuid[]; fact_ids uuid[]; cursor jsonb;
begin
  perform internal.staff_actor('evidence:view');
  perform internal.staff_actor('case:claim');
  if p_owner is null or (p_before_time is null)<>(p_before_id is null) then
    raise exception 'subject and complete history cursor required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(p_owner);
  actor:=internal.staff_actor('decision:propose');
  perform internal.staff_actor('evidence:view');
  perform internal.staff_actor('case:claim');
  if actor=p_owner then raise exception 'independent review required' using errcode='42501'; end if;
  if not exists(select 1 from auth.users u where u.id=p_owner) then
    raise exception 'subject unavailable' using errcode='22023'; end if;
  select e.* into c from private.evidence_cases e where e.subject_id=p_owner and e.kind='restriction'
    and e.status='open' and ((e.claimed_by=actor and e.claim_expires_at>clock_timestamp())
      or ((e.claim_expires_at is null or e.claim_expires_at<=clock_timestamp()) and e.claim_generation<9223372036854775807))
    and not exists(select 1 from private.decisions d where d.case_id=e.id)
    order by (e.claimed_by=actor and e.claim_expires_at>clock_timestamp()) desc nulls last,e.created_at desc,e.id desc limit 1;
  if not found then
    insert into private.evidence_cases(subject_id,kind,claimed_by,claim_expires_at,claim_generation,claim_nonce)
      values(p_owner,'restriction',actor,clock_timestamp()+interval '30 minutes',1,pg_catalog.gen_random_uuid()) returning * into c;
  elsif c.claimed_by is distinct from actor or c.claim_expires_at is null or c.claim_expires_at<=clock_timestamp() then
    update private.evidence_cases set claimed_by=actor,claim_expires_at=clock_timestamp()+interval '30 minutes',
      claim_generation=claim_generation+1,claim_nonce=pg_catalog.gen_random_uuid() where id=c.id and claim_generation<9223372036854775807 returning * into c;
    if not found then raise exception 'claim generation exhausted' using errcode='PT409'; end if;
  end if;
  perform internal.assert_evidence_claim(c,actor,c.claim_generation::text,c.claim_nonce);
  select coalesce(jsonb_agg(jsonb_build_object('identity_fact_id',f.id,'submission_id',f.submission_id,
    'reviewed_at',f.reviewed_at,'identity_is_current',f.revoked_at is null) order by f.reviewed_at desc,f.id desc),'[]'::jsonb)
    into items from (select x.* from private.accepted_identity_facts x where x.owner_id=p_owner
      and (p_before_time is null or (x.reviewed_at,x.id)<(p_before_time,p_before_id))
      order by x.reviewed_at desc,x.id desc limit 21) f;
  more:=jsonb_array_length(items)>20;
  if more then items:=items-20; end if;
  select coalesce(array_agg(distinct artifact),'{}'::uuid[]) into ids
    from private.accepted_identity_facts f join private.verification_identity_submissions s on s.id=f.submission_id
    cross join lateral unnest(array[s.id_artifact_id,s.selfie_artifact_id]) artifact
    where f.owner_id=p_owner and f.id in(select (j->>'identity_fact_id')::uuid from jsonb_array_elements(items) j);
  select coalesce(array_agg((j->>'identity_fact_id')::uuid),'{}'::uuid[]) into fact_ids from jsonb_array_elements(items) j;
  insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids,identity_fact_ids)
    values(actor,c.id,'identity_enforcement_review',c.version,c.claim_generation,ids,fact_ids);
  actor:=internal.staff_actor('decision:propose');
  perform internal.staff_actor('evidence:view');
  perform internal.staff_actor('case:claim');
  perform internal.assert_evidence_claim(c,actor,c.claim_generation::text,c.claim_nonce);
  if more then
    cursor:=jsonb_build_object('before_time',items->(jsonb_array_length(items)-1)->>'reviewed_at',
      'before_id',items->(jsonb_array_length(items)-1)->>'identity_fact_id');
  end if;
  return jsonb_build_object('case_id',c.id,'case_version',c.version,'claim_generation',c.claim_generation::text,
    'claim_nonce',c.claim_nonce,'claim_expires_at',c.claim_expires_at,'identities',items,'next_cursor',cursor);
end;
$function$;
alter function internal.staff_identity_history(uuid,timestamp with time zone,uuid) owner to postgres;
revoke all on function internal.staff_identity_history(uuid,timestamp with time zone,uuid) from public;
grant execute on function internal.staff_identity_history(uuid,timestamp with time zone,uuid) to authenticated;
