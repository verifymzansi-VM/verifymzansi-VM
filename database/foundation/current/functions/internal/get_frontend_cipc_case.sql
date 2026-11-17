-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_cipc_case(p_case uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');x private.frontend_business_checks;c private.evidence_cases;
  d private.frontend_cipc_reviews;owner_doc private.frontend_cipc_documents;official_doc private.frontend_cipc_documents;
  root private.frontend_current_cipc_stickers;exception_row private.frontend_cipc_exceptions;permitted boolean;
  result jsonb;missing text[]:='{}';hard text[]:='{}';ids uuid[];role_text text;position_text text;company_name text;
begin
  select * into x from private.frontend_business_checks where id=p_case and kind in('cipc','cipc_link');
  if not found then return null;end if;
  perform internal.lock_verification_subject(x.owner_id);
  select * into x from private.frontend_business_checks where id=p_case and kind in('cipc','cipc_link');
  if not found then return null;end if;
  select * into d from private.frontend_cipc_reviews where check_id=x.id and submitted_at is not null;
  if not found then return null;end if;
  select * into c from private.evidence_cases where id=x.id;
  permitted:=actor<>x.owner_id and coalesce(actor=x.reviewed_by or (c.status='open' and c.claimed_by=actor and c.claim_expires_at>clock_timestamp()),false);
  if permitted then
    perform internal.staff_actor('evidence:view');
    select * into owner_doc from private.frontend_cipc_documents where artifact_id=d.owner_file;
    select * into official_doc from private.frontend_cipc_documents where artifact_id=d.official_file;
    select * into exception_row from private.frontend_cipc_exceptions where check_id=x.id and official_file=d.official_file;
    select coalesce(array_agg(e.artifact_id),'{}') into ids from private.frontend_cipc_documents e join private.evidence_artifacts a on a.id=e.artifact_id
      where e.check_id=x.id and e.recorded_at is not null and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp());
    insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
      values(actor,c.id,'routine_review',c.version,c.claim_generation,ids);
    if x.kind='cipc_link' then
      select * into root from private.frontend_current_cipc_stickers s where s.business_id=d.linked_business_id
        and s.owner_id=x.owner_id and s.registration_number=d.registration_number and s.kind='cipc';
      if not found then hard:=array_append(hard,'The source profile no longer holds a current CIPC sticker.');end if;
      company_name:=root.registered_name;role_text:=root.accepted_role;position_text:=root.position_title;
    else
      if official_doc.artifact_id is null or not (official_doc.artifact_id=any(ids)) then
        hard:=array_append(hard,'Attach the current copy you fetched from CIPC.');
      elsif official_doc.summary->>'registrationNumber' is distinct from d.registration_number then
        hard:=array_append(hard,'The official copy is for a different registration number.');
      elsif lower(btrim(official_doc.summary->>'enterpriseStatus')) is distinct from 'in business' then
        hard:=array_append(hard,'The official register must show the company as In Business.');
      end if;
      company_name:=official_doc.summary->>'registeredName';
      if d.route='representative' then
        if d.representative_verified_at is null or not d.domain_confirmed or not d.callback_confirmed then
          hard:=array_append(hard,'Confirm the representative by work email and independent callback.');
        end if;
        role_text:='representative';position_text:=d.representative_position;
      elsif official_doc.owner_match_fingerprint is null or not exists(select 1 from private.accepted_identity_facts f
        where f.owner_id=x.owner_id and f.identity_hmac=official_doc.owner_match_fingerprint and f.revoked_at is null) then
        if internal.frontend_cipc_legal_name_match(x.owner_id,official_doc.summary) then
          missing:=array_append(missing,'The official copy does not include a matching ID. A second reviewer must confirm the unique legal name.');
        else hard:=array_append(hard,'The current owner does not match a director on the official copy.');end if;
      else
        role_text:=case when official_doc.owner_match_position ilike '%member%' then 'member' else 'director' end;
        position_text:=official_doc.owner_match_position;
      end if;
    end if;
    if exists(select 1 from private.frontend_current_cipc_stickers s where s.registration_number=d.registration_number and s.owner_id<>x.owner_id)
      then hard:=array_append(hard,'Another owner already holds this registration.');end if;
    if not internal.frontend_business_identity_reviewed(x.owner_id) then hard:=array_append(hard,'The owner needs a current ID review.');end if;
  else hard:=array_append(hard,'Claim this case to inspect the private review details.');end if;
  missing:=hard||missing;
  select jsonb_build_object('id',x.id,'ownerId',x.owner_id,'kind',x.kind,'route',d.route,'status',case when x.revoked_at is not null then 'revoked' else x.status end,
    'registrationNumber',d.registration_number,'createdAt',x.created_at,'updatedAt',x.updated_at,'decidedAt',x.decided_at,'expiresAt',x.expires_at,
    'reasonCode',x.reason_code,'reviewNote',case when permitted then x.review_note end,
    'business',jsonb_build_object('id',p.id,'business_name',p.title,'slug',s.slug,'status',p.status,'location_city',city.label,'location_province',prov.label),
    'owner',jsonb_build_object('displayName',pr.display_name,'legalName',case when permitted then nullif(concat_ws(' ',pr.legal_first_name,pr.legal_last_name),'') end,
      'idReviewed',internal.frontend_business_identity_reviewed(x.owner_id)),
    'parsed',owner_doc.summary,'official',official_doc.summary,
    'office',case when permitted then coalesce(d.office_override,d.registered_office,nullif(official_doc.summary->'registeredOffice','null'::jsonb),nullif(owner_doc.summary->'registeredOffice','null'::jsonb)) end,
    'representative',case when permitted and d.route='representative' then jsonb_build_object('email',d.representative_email,'position',d.representative_position,
      'emailVerifiedAt',d.representative_verified_at,'domainConfirmed',d.domain_confirmed,'callback',d.callback_record,
      'confirmed',d.representative_verified_at is not null and d.domain_confirmed and d.callback_confirmed) end,
    'exception',case when exception_row.check_id is not null then jsonb_build_object('proposedBy',exception_row.proposed_by,'confirmedBy',exception_row.confirmed_by,'reason',exception_row.reason) end,
    'evidence',jsonb_build_object('ready',cardinality(missing)=0,'missing',missing,'unwaivable',hard,'role',role_text,'position',position_text,'registeredName',company_name),
    'files',case when permitted then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'kind',e.source,'content_type','application/pdf',
      'size_bytes',a.size_bytes,'created_at',a.created_at,'quarantined',false,'purged_at',a.deleted_at) order by a.created_at,a.id)
      from private.evidence_artifacts a join private.frontend_cipc_documents e on e.artifact_id=a.id where a.id=any(ids)),'[]'::jsonb) else '[]'::jsonb end,
    'messages',case when permitted then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author_id',m.author_id,
      'author_role',m.author_role,'body',m.body,'created_at',m.created_at,'attachment_file_id',case when m.attachment_file_id=any(ids) then m.attachment_file_id end)
      order by m.created_at,m.id) from (select * from private.frontend_business_check_messages where check_id=x.id order by created_at desc,id desc limit 100)m),'[]'::jsonb) else '[]'::jsonb end,
    'accessLog',case when permitted then coalesce((select jsonb_agg(jsonb_build_object('actor_id',a.staff_id,'action',a.purpose,'created_at',a.accessed_at) order by a.accessed_at desc)
      from (select * from private.evidence_access_log where case_id=x.id order by accessed_at desc limit 10)a),'[]'::jsonb) else '[]'::jsonb end)
  into result from private.posts p left join private.post_slugs s on s.post_id=p.id left join private.profiles pr on pr.account_id=x.owner_id
    left join private.cities city on city.id=p.city_id left join private.provinces prov on prov.id=p.province_id
    where p.id=x.business_id and p.owner_id=x.owner_id;
  perform internal.staff_actor('queue:view');return result;
end$function$;
alter function internal.get_frontend_cipc_case(uuid) owner to postgres;
revoke all on function internal.get_frontend_cipc_case(uuid) from public;
grant execute on function internal.get_frontend_cipc_case(uuid) to authenticated;
