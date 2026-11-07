-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.request_frontend_cipc_recheck(p_business uuid, p_source uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();prior private.frontend_cipc_latest_result;source private.frontend_current_cipc_stickers;
  case_id uuid;kind text;registration text;review_route text;parent uuid;root uuid;
begin
  perform internal.lock_verification_subject(actor);actor:=internal.price_draft_actor();
  if not internal.frontend_business_identity_reviewed(actor) then raise exception 'reviewed owner identity required' using errcode='42501';end if;
  perform 1 from private.posts p where p.id=p_business and p.owner_id=actor and p.kind='business' and p.edit_of is null
    and p.status not in('archived','sold') for update;
  if not found then raise exception 'business unavailable' using errcode='PT404';end if;
  if exists(select 1 from private.frontend_business_checks x where x.business_id=p_business and x.kind in('cipc','cipc_link')
    and x.status in('pending','info_requested')) then raise exception 'this business already has a CIPC check in review' using errcode='PT409';end if;
  if p_source is null then
    select * into prior from private.frontend_cipc_latest_result where business_id=p_business and owner_id=actor;
    if not found or prior.kind<>'cipc' or prior.status<>'approved' then raise exception 'no independent CIPC sticker to renew' using errcode='PT409';end if;
    if prior.expires_at>clock_timestamp()+interval '60 days' then raise exception 'renewal opens 60 days before expiry' using errcode='PT409';end if;
    kind:='cipc';registration:=prior.registration_number;review_route:=prior.route;parent:=prior.id;
  else
    if p_source=p_business then raise exception 'choose another verified profile' using errcode='22023';end if;
    select * into source from private.frontend_current_cipc_stickers where business_id=p_source and owner_id=actor;
    if not found then raise exception 'choose a current CIPC verified profile on your account' using errcode='PT409';end if;
    root:=coalesce(source.linked_business_id,source.business_id);
    if root=p_business then raise exception 'choose an independent source profile' using errcode='22023';end if;
    kind:='cipc_link';registration:=source.registration_number;review_route:='director';parent:=source.id;
  end if;
  insert into private.evidence_cases(subject_id,kind) values(actor,'business') returning id into case_id;
  insert into private.frontend_business_checks(id,business_id,owner_id,kind) values(case_id,p_business,actor,kind);
  insert into private.frontend_cipc_reviews(check_id,registration_number,route,submitted_at,prior_check,linked_business_id,renewal,display_full_office)
    values(case_id,registration,review_route,clock_timestamp(),parent,root,p_source is null,coalesce(prior.display_full_office,false));
  perform internal.price_draft_actor();return jsonb_build_object('caseId',case_id,'status','pending');
end$function$;
alter function internal.request_frontend_cipc_recheck(uuid,uuid) owner to postgres;
revoke all on function internal.request_frontend_cipc_recheck(uuid,uuid) from public;
grant execute on function internal.request_frontend_cipc_recheck(uuid,uuid) to authenticated;
