-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reserve_frontend_seen_photo(p_case uuid, p_digest text, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_mime text DEFAULT 'image/jpeg'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('case:claim');x private.frontend_business_checks;art private.evidence_artifacts;existing private.frontend_business_seen_photos;
begin
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' or p_lat not between -90 and 90 or p_lng not between -180 and 180
    or p_mime is null or p_mime not in('image/jpeg','image/png','image/webp')
    then raise exception 'valid visit photograph required' using errcode='22023';end if;
  x:=internal.lock_frontend_seen_case(p_case);actor:=internal.staff_actor('case:claim');
  if x.owner_id=actor or x.assigned_to is distinct from actor or x.visit_report is not null
    then raise exception 'only the assigned verifier can upload before reporting' using errcode='42501';end if;
  select * into existing from private.frontend_business_seen_photos p where p.check_id=x.id and p.content_digest=p_digest;
  if found then
    select * into art from private.evidence_artifacts where id=existing.artifact_id;
    if existing.verifier_id is distinct from actor or existing.mime<>p_mime or art.state not in('intent','uploaded','clean')
      then raise exception 'photo upload no longer available' using errcode='PT409';end if;
    return jsonb_build_object('artifact_id',art.id,'owner_id',x.owner_id,'completed',art.state='clean');
  end if;
  if (select count(*) from private.frontend_business_seen_photos where check_id=x.id)>=12 then raise exception 'visit photo limit reached' using errcode='PT429';end if;
  insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
    values(x.id,x.owner_id,'business_visit_photo','evidence/'||x.id||'/'||gen_random_uuid()) returning * into art;
  insert into private.frontend_business_seen_photos(artifact_id,check_id,verifier_id,content_digest,mime,latitude,longitude)
    values(art.id,x.id,actor,p_digest,p_mime,case when x.seen_method='visit' then p_lat end,case when x.seen_method='visit' then p_lng end);
  return jsonb_build_object('artifact_id',art.id,'owner_id',x.owner_id,'completed',false);
end$function$;
alter function internal.reserve_frontend_seen_photo(uuid,text,numeric,numeric,text) owner to postgres;
revoke all on function internal.reserve_frontend_seen_photo(uuid,text,numeric,numeric,text) from public;
grant execute on function internal.reserve_frontend_seen_photo(uuid,text,numeric,numeric,text) to authenticated;
