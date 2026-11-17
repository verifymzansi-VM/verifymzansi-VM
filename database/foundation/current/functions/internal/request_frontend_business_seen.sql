-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.request_frontend_business_seen(p_business uuid, p_method text, p_slots text[], p_consent boolean, p_address text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();post private.posts;x private.frontend_business_checks;
  requested uuid;address text;slots text[];now_at timestamptz;
begin
  if p_method is null or p_method not in('video','visit') or p_consent is distinct from true or p_slots is null
    or cardinality(p_slots) not between 1 and 3 or array_ndims(p_slots)<>1
    then raise exception 'method, availability and screenshot consent required' using errcode='22023';end if;
  if p_method='visit' then address:=internal.privacy_text(p_address,5,300);end if;
  select array_agg(internal.privacy_text(s.slot,3,80) order by s.n) into slots from unnest(p_slots) with ordinality s(slot,n);
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  select * into post from private.posts p where p.id=p_business and p.owner_id=actor and p.kind='business'
    and p.edit_of is null and p.status not in('archived','sold') for update;
  if not found then raise exception 'business unavailable for this member' using errcode='PT404';end if;
  if not internal.frontend_business_identity_reviewed(actor) then raise exception 'reviewed owner identity required' using errcode='42501';end if;
  now_at:=clock_timestamp();
  select * into x from private.frontend_business_checks c where c.business_id=post.id and c.kind='seen' and c.status in('pending','info_requested');
  if found then
    if x.owner_id=actor and x.status='pending' and x.seen_method=p_method and x.available_slots=slots
      and x.visit_address is not distinct from address and x.created_at>now_at-interval '10 minutes'
      then return jsonb_build_object('caseId',x.id,'status','pending','reused',true);end if;
    raise exception 'this business already has a check in progress' using errcode='PT409';
  end if;
  insert into private.evidence_cases(subject_id,kind) values(actor,'business') returning id into requested;
  insert into private.frontend_business_checks(id,business_id,owner_id,kind,seen_method,visit_address,available_slots,screenshots_consent_at,created_at,updated_at)
    values(requested,post.id,actor,'seen',p_method,address,slots,now_at,now_at,now_at);
  perform internal.price_draft_actor();
  return jsonb_build_object('caseId',requested,'status','pending');
end$function$;
alter function internal.request_frontend_business_seen(uuid,text,text[],boolean,text) owner to postgres;
revoke all on function internal.request_frontend_business_seen(uuid,text,text[],boolean,text) from public;
grant execute on function internal.request_frontend_business_seen(uuid,text,text[],boolean,text) to authenticated;
