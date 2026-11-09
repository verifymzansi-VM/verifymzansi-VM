-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reassign_frontend_staff_claim(p_type text, p_id uuid, p_to uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:reassign');subject uuid;c private.evidence_cases;reason text;previous uuid;
begin
  if p_id is null then raise exception 'typed queue subject required' using errcode='22023';end if;
  if p_type in('report','listing','business','promotion','content_edit') then
    if p_type='report' then
      if not exists(select 1 from private.reports x where x.id=p_id) then raise exception 'report unavailable' using errcode='22023';end if;
    elsif not exists(select 1 from private.posts p where p.id=p_id and
      (p_type='content_edit' and p.edit_of is not null or p.edit_of is null and p.kind=case p_type when 'promotion' then 'event' else p_type end)) then
      raise exception 'post type changed' using errcode='22023';end if;
    return internal.reassign_queue_claim(case when p_type='report' then 'report' else 'post' end,p_id,p_to,p_reason);
  end if;
  if p_type is null or p_type not in('verification_step','business_verification') then raise exception 'typed evidence case required' using errcode='22023';end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb,to_jsonb(p_reason))#>>'{}';
  if reason is null or reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'valid reason required' using errcode='22023';end if;
  if p_to is not null then perform pg_advisory_xact_lock(hashtextextended(p_to::text,1201));end if;
  select e.subject_id into subject from private.evidence_cases e where e.id=p_id;
  if not found then raise exception 'case unavailable' using errcode='22023';end if;
  perform internal.lock_evidence_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=p_id for update;
  if not found then raise exception 'case unavailable' using errcode='22023';end if;
  actor:=internal.staff_actor('queue:reassign');
  if c.subject_id=actor or c.subject_id=p_to then raise exception 'self-review is not allowed' using errcode='42501';end if;
  if c.kind<>(case p_type when 'verification_step' then 'kyc' else 'business' end) then raise exception 'case type changed' using errcode='22023';end if;
  if c.status<>'open' or c.claimed_by is null or c.claim_expires_at<=clock_timestamp() then raise exception 'nobody holds this case' using errcode='PT409';end if;
  previous:=c.claimed_by;
  if p_to is null then
    update private.evidence_cases set claimed_by=null,claim_nonce=null,claim_expires_at=null where id=c.id;
  else
    if p_to=previous then raise exception 'reviewer already holds this case' using errcode='22023';end if;
    if not exists(select 1 from private.staff_roles r join private.staff_capabilities k on k.role=r.role
      join private.current_account_access a on a.id=r.user_id where r.user_id=p_to and r.revoked_at is null and k.capability='case:claim') then
      raise exception 'independent eligible reviewer required' using errcode='22023';end if;
    update private.evidence_cases set claimed_by=p_to,claim_generation=claim_generation+1,claim_nonce=gen_random_uuid(),claim_expires_at=clock_timestamp()+interval '30 minutes'
      where id=c.id and claim_generation<9223372036854775807 returning * into c;
    if not found then raise exception 'claim generation exhausted' using errcode='PT409';end if;
  end if;
  insert into private.frontend_evidence_claim_events(case_id,actor_id,from_staff,to_staff,event,claim_generation,reason)
    values(c.id,actor,previous,p_to,case when p_to is null then 'released_by_staff' else 'reassigned' end,c.claim_generation,reason);
  perform internal.staff_actor('queue:reassign');
  return jsonb_build_object('subject','case','id',c.id,'status',case when p_to is null then 'released' else 'reassigned' end,'claim_generation',c.claim_generation::text);
end$function$;
alter function internal.reassign_frontend_staff_claim(text,uuid,uuid,text) owner to postgres;
revoke all on function internal.reassign_frontend_staff_claim(text,uuid,uuid,text) from public;
grant execute on function internal.reassign_frontend_staff_claim(text,uuid,uuid,text) to authenticated;
