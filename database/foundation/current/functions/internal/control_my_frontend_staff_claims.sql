-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.control_my_frontend_staff_claims(p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');snapshot jsonb;r record;n integer:=0;
begin
  if p_action is null or p_action not in('renew','release') then raise exception 'claim action required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,1201));
  snapshot:=internal.get_frontend_staff_claims();
  -- Subject guards precede all work rows, including mixed post/evidence batches.
  for r in select distinct c.subject_id from private.evidence_cases c join jsonb_array_elements(snapshot->'items') x
      on x->>'subject'='case' and (x->>'id')::uuid=c.id order by c.subject_id
  loop perform internal.lock_evidence_subject(r.subject_id);end loop;
  for r in select x->>'subject' subject,(x->>'id')::uuid id,x->>'generation' generation,(x->>'nonce')::uuid nonce
      from jsonb_array_elements(snapshot->'items') x order by x->>'subject',x->>'id'
  loop
    if r.subject='case' then
      if p_action='renew' then perform internal.renew_evidence_claim(r.id,r.generation,r.nonce);
      else perform internal.release_evidence_claim(r.id,r.generation,r.nonce);end if;
      perform internal.staff_actor('case:claim');
    elsif p_action='renew' then perform internal.renew_queue_claim(r.subject,r.id,r.generation,r.nonce);
    else perform internal.release_queue_claim(r.subject,r.id,r.generation,r.nonce);end if;
    n:=n+1;
  end loop;
  perform internal.staff_actor('queue:view');
  return jsonb_build_object(case p_action when 'renew' then 'renewed' else 'released' end,n);
end$function$;
alter function internal.control_my_frontend_staff_claims(text) owner to postgres;
revoke all on function internal.control_my_frontend_staff_claims(text) from public;
grant execute on function internal.control_my_frontend_staff_claims(text) to authenticated;
