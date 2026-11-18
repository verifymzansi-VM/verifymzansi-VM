-- Reviewed rollback for updates/20261118072601_staff_data_minimisation.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. It restores the previous bodies
-- of the 10 replaced functions byte for byte, drops both
-- reveal_organisation_applicant_contact commands and restores the two closed
-- lists. To restore the lists it deletes the members' notices of the two new
-- kinds (and their dismissals) and the requester emails of the two new kinds
-- (sent or not). The organisation event log keeps its reveal records.
--
-- ORDER: run it before the expand website release is reverted (this pull
-- request's release works without the update).
begin;
set local lock_timeout='5s';

do $$begin
  if false
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_business_review_queue(text)')) is distinct from '02eed4ae21b86c982feda572871add03'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_seen_queue(text)')) is distinct from '1739b49ce16a79538ed569b6668b5910'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_seen_case(uuid)')) is distinct from '1275da13ade5358710b03902b00e7248'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_cipc_case(uuid)')) is distinct from 'ed026d48191cac201053305cde485957'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.staff_verification_queue(integer)')) is distinct from '8ecd9727c64d6c8dee4e4af2e8da4649'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_staff_verification_queue(integer,uuid[])')) is distinct from '9c87b1e5234ba46a5678cf6bb0b4d3c1'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text)')) is distinct from '934dfff07e993b1ca95f48b21b2e6435'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.export_frontend_privacy_request(uuid,integer)')) is distinct from '939737e433fcf800d5e98a3dd1569e5d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_support_inbox(integer,uuid)')) is distinct from '5210ff93931941d85a1daae444a71669'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_organisation_dashboard(text)')) is distinct from '50c7ba8869e2fc3f8cc5b68bb0e2f4ed'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.reveal_organisation_applicant_contact(uuid)')) is distinct from '67dc202cf393e44675ea7af95b1bf672'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.reveal_organisation_applicant_contact(uuid)')) is distinct from 'f6b2088f77d110d2b5be6683f8d6cb9a'
    or (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','content_restored','draft_deletion_warning','enquiry_received','identity_accepted','invoice_issued','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','payment_completed','payment_reconciliation_required','payment_reversed','post_approved','post_changes_approved','post_changes_rejected','post_deleted','post_expired','post_kept','post_rejected','post_sold','privacy_export_made','privacy_request_approved','slot_renewal_reminder','trial_started','verification_phone_confirmed','verification_returned']::text[]
    or (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.privacy_notice_jobs'::regclass and c.conname='privacy_notice_jobs_kind_check') is distinct from array['approved','completed','exported','extended','rejected','submitted']::text[] then
    raise exception 'rollback precondition: the staff data minimisation update is not applied' using errcode='55000';
  end if;
end$$;

lock table private.privacy_notice_jobs,private.notifications in access exclusive mode nowait;

drop function api.reveal_organisation_applicant_contact(uuid);
drop function internal.reveal_organisation_applicant_contact(uuid);

CREATE OR REPLACE FUNCTION internal.get_frontend_business_review_queue(p_tab text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');seen jsonb;result jsonb;
begin
  seen:=internal.get_frontend_seen_queue(p_tab);
  with rows as (
    select x.id,x.kind,x.status,x.business_id,x.created_at,x.updated_at,x.decided_at,d.route,d.registration_number,d.renewal,
      coalesce(p.title,'Business') business_name,coalesce(pr.display_name,'Member') owner_name,
      e.claimed_by=actor and e.claim_expires_at>clock_timestamp() mine,
      exists(select 1 from private.frontend_cipc_exceptions exc where exc.check_id=x.id and exc.official_file=d.official_file and exc.confirmed_at is null) exception_pending,
      exists(select 1 from private.frontend_current_cipc_stickers s where s.registration_number=d.registration_number and s.owner_id<>x.owner_id) conflict
    from private.frontend_business_checks x join private.frontend_cipc_reviews d on d.check_id=x.id and d.submitted_at is not null
    join private.posts p on p.id=x.business_id join private.evidence_cases e on e.id=x.id
    left join private.profiles pr on pr.account_id=x.owner_id where x.owner_id<>actor
  ), labelled as (
    select r.*,case when status not in('pending','info_requested') then 'decided'
      when status='info_requested' then 'waiting' when exception_pending then 'exceptions'
      when conflict then 'conflicts' when route='representative' then 'representatives'
      when renewal then 'renewals' else 'review' end tab from rows r
  ), merged as (
    select j.value item from jsonb_array_elements(seen->'rows') j
    union all
    select jsonb_build_object('id',x.id,'kind',x.kind,'route',x.route,'status',x.status,'businessId',x.business_id,
      'businessName',x.business_name,'ownerName',x.owner_name,'registrationNumber',x.registration_number,
      'red',case when x.conflict then 1 else 0 end,'amber',case when x.renewal then 1 else 0 end,
      'createdAt',x.created_at,'updatedAt',x.updated_at,'exceptionPending',x.exception_pending,'conflict',x.conflict,'renewal',x.renewal)
    from labelled x where x.tab=p_tab or (p_tab<>'decided' and x.tab<>'decided' and x.mine)
  )
  select jsonb_build_object('actor_id',actor,
    'counts',(select jsonb_object_agg(k,case when k='decided' then null else (seen->'counts'->>k)::bigint+(select count(*) from labelled where tab=k) end)
      from jsonb_object_keys(seen->'counts') k),
    'rows',coalesce((select jsonb_agg(r.item) from (select item from merged order by
      case when p_tab='decided' then -(extract(epoch from (item->>'updatedAt')::timestamptz)) else -(item->>'red')::integer end,
      (item->>'createdAt')::timestamptz,item->>'id' limit 200)r),'[]'::jsonb)) into result;
  perform internal.staff_actor('queue:view');return result;
end$function$;
alter function internal.get_frontend_business_review_queue(text) owner to postgres;
revoke all on function internal.get_frontend_business_review_queue(text) from public;
grant execute on function internal.get_frontend_business_review_queue(text) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_frontend_seen_queue(p_tab text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');answer jsonb;
begin
  if p_tab is null or p_tab not in('review','representatives','visits','conflicts','renewals','exceptions','waiting','decided')
    then raise exception 'valid business review queue required' using errcode='22023';end if;
  with cases as (
    select x.*,p.title as business_name,pr.display_name as owner_name,
      case when x.status='info_requested' then 'waiting' when x.status='pending' then 'visits' else 'decided' end tab,
      e.claimed_by=actor and e.claim_expires_at>clock_timestamp() as mine
    from private.frontend_business_checks x join private.posts p on p.id=x.business_id
    join private.evidence_cases e on e.id=x.id left join private.profiles pr on pr.account_id=x.owner_id
    where x.kind='seen' and x.owner_id<>actor
  )
  select jsonb_build_object('actor_id',actor,
    'counts',jsonb_build_object('visits',(select count(*) from cases where tab='visits'),
      'waiting',(select count(*) from cases where tab='waiting'),'decided',null,
      'review',0,'representatives',0,'conflicts',0,'renewals',0,'exceptions',0),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'kind','seen','route',null,'status',x.status,
      'businessId',x.business_id,'businessName',coalesce(x.business_name,'Business'),'ownerName',coalesce(x.owner_name,'Member'),
      'registrationNumber',null,'red',0,'amber',0,'createdAt',x.created_at,'updatedAt',x.updated_at,
      'exceptionPending',false,'conflict',false,'renewal',false) order by x.sort_at,x.id)
      from (select c.*,case when p_tab='decided' then -extract(epoch from c.decided_at) else extract(epoch from c.created_at) end sort_at
        from cases c where c.tab=p_tab or (p_tab<>'decided' and c.tab<>'decided' and c.mine)
        order by sort_at,id limit 200)x),'[]'::jsonb)) into answer;
  perform internal.staff_actor('queue:view');return answer;
end$function$;
alter function internal.get_frontend_seen_queue(text) owner to postgres;
revoke all on function internal.get_frontend_seen_queue(text) from public;
grant execute on function internal.get_frontend_seen_queue(text) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_frontend_seen_case(p_case uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');answer jsonb;x private.frontend_business_checks;ec private.evidence_cases;private_read boolean:=false;ids uuid[];
begin
  select * into x from private.frontend_business_checks where id=p_case and kind='seen';
  if not found then return null;end if;
  perform internal.lock_verification_subject(x.owner_id);
  select * into x from private.frontend_business_checks where id=p_case and kind='seen';
  if not found then return null;end if;
  select * into ec from private.evidence_cases where id=x.id;
  if actor<>x.owner_id and (actor=x.assigned_to or actor=x.reviewed_by or
    (ec.status='open' and ec.claimed_by=actor and ec.claim_expires_at>clock_timestamp())) then
    perform internal.staff_actor('evidence:view');private_read:=true;
  end if;
  if private_read then
    select coalesce(array_agg(p.artifact_id),'{}') into ids from private.frontend_business_seen_files p join private.evidence_artifacts a on a.id=p.artifact_id
      where p.check_id=x.id and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp());
    insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
      values(actor,ec.id,'routine_review',ec.version,ec.claim_generation,ids);
  end if;
  select jsonb_build_object('id',x.id,'ownerId',x.owner_id,'kind','seen','status',x.status,'createdAt',x.created_at,'updatedAt',x.updated_at,
    'decidedAt',x.decided_at,'expiresAt',x.expires_at,'reviewNote',case when private_read then x.review_note end,'reasonCode',x.reason_code,
    'business',jsonb_build_object('id',p.id,'business_name',p.title,'slug',s.slug,'status',p.status,'location_city',city.label,'location_province',prov.label),
    'owner',jsonb_build_object('displayName',pr.display_name,'legalName',case when private_read then nullif(concat_ws(' ',pr.legal_first_name,pr.legal_last_name),'') end,
      'idReviewed',internal.frontend_business_identity_reviewed(x.owner_id)),
    'seen',jsonb_build_object('method',x.seen_method,'address',case when private_read then x.visit_address end,
      'slots',case when private_read then x.available_slots end,'assignedTo',x.assigned_to,'scheduledFor',x.scheduled_for,
      'photos',case when private_read then coalesce((select jsonb_agg(jsonb_build_object('fileId',ph.artifact_id,'by',ph.verifier_id,'takenAt',ph.created_at,
        'lat',ph.latitude,'lng',ph.longitude) order by ph.created_at,ph.artifact_id) from private.frontend_business_seen_photos ph
        where ph.artifact_id=any(ids)),'[]'::jsonb) else '[]'::jsonb end,
      'report',case when private_read and x.visit_report is not null then x.visit_report||jsonb_build_object('by',x.report_by,'at',x.report_at) end),
    'files',case when private_read then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'kind',ph.kind,
      'content_type',ph.mime,'size_bytes',a.size_bytes,'created_at',a.created_at,'quarantined',false,'purged_at',a.deleted_at)
      order by a.created_at,a.id) from private.evidence_artifacts a join private.frontend_business_seen_files ph on ph.artifact_id=a.id
      where a.id=any(ids)),'[]'::jsonb) else '[]'::jsonb end,
    'messages',case when private_read then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author_id',m.author_id,
      'author_role',m.author_role,'body',m.body,'created_at',m.created_at,'attachment_file_id',case when m.attachment_file_id=any(ids) then m.attachment_file_id end) order by m.created_at,m.id)
      from (select * from private.frontend_business_check_messages where check_id=x.id order by created_at desc,id desc limit 100)m),'[]'::jsonb)
      else '[]'::jsonb end)
  into answer from private.posts p left join private.post_slugs s on s.post_id=p.id left join private.profiles pr on pr.account_id=x.owner_id
    left join private.cities city on city.id=p.city_id left join private.provinces prov on prov.id=p.province_id
    where p.id=x.business_id and p.owner_id=x.owner_id;
  perform internal.staff_actor('queue:view');return answer;
end$function$;
alter function internal.get_frontend_seen_case(uuid) owner to postgres;
revoke all on function internal.get_frontend_seen_case(uuid) from public;
grant execute on function internal.get_frontend_seen_case(uuid) to authenticated;

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

CREATE OR REPLACE FUNCTION internal.staff_verification_queue(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('case:claim'); rows jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1 to 100' using errcode='22023'; end if;
  select coalesce(jsonb_agg(row),'[]'::jsonb) into rows from(
    select jsonb_build_object('case_id',c.id,'version',c.version,'display_name',p.display_name,
      'submitted_at',s.created_at,'risk_score',s.risk_score,'decision_id',d.id,'proposed_by',d.proposed_by) as row
    from private.evidence_cases c join private.verification_current_submissions v on v.case_id=c.id
    join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version
    join private.profiles p on p.account_id=c.subject_id
    left join private.decisions d on d.case_id=c.id and d.status='proposed' and d.action='approve_override'
    where c.kind='kyc' and c.status='open' and c.subject_id<>actor
    order by s.risk_score desc,s.created_at,c.id limit p_limit
  ) x;
  return rows;
end;
$function$;
alter function internal.staff_verification_queue(integer) owner to postgres;
revoke all on function internal.staff_verification_queue(integer) from public;
grant execute on function internal.staff_verification_queue(integer) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_verification_queue(p_limit integer DEFAULT 100, p_include_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('case:claim');result jsonb;rows jsonb;total bigint;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_include_ids is null or cardinality(p_include_ids)>300 then raise exception 'bounded identity queue required' using errcode='22023';end if;
  with ready as(select c.id,c.subject_id,c.version,c.claim_generation,c.claim_nonce,c.claimed_by,c.claim_expires_at,
      s.id submission_id,s.id_artifact_id,s.selfie_artifact_id,s.created_at,s.risk_score,p.display_name,
      row_number() over(order by s.risk_score desc,s.created_at,c.id) n
      from private.evidence_cases c join private.verification_current_submissions v on v.case_id=c.id
      join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version
      join private.profiles p on p.account_id=c.subject_id
      where c.kind='kyc' and c.status='open' and c.subject_id<>actor
      and exists(select 1 from private.current_account_access u where u.id=c.subject_id)
  )
  select coalesce((select jsonb_agg(jsonb_build_object('case_id',r.id,'owner_id',r.subject_id,'version',r.version,'display_name',r.display_name,
      'created_at',r.created_at,'steps',internal.frontend_identity_queue_steps(r.id),
      'review_scope',case when r.claimed_by=actor and r.claim_expires_at>statement_timestamp() then jsonb_build_object(
        'caseId',r.id,'caseVersion',r.version,'submissionId',r.submission_id,'claimGeneration',r.claim_generation::text,'claimNonce',r.claim_nonce) end) order by r.risk_score desc,r.created_at,r.id)
      from (select * from ready where n<=p_limit or id=any(p_include_ids) or claimed_by=actor and claim_expires_at>statement_timestamp() order by n limit 1401) r),'[]'::jsonb),
    2*(select count(*) from ready)-(select count(*) from private.frontend_identity_step_approvals a join ready r on r.submission_id=a.submission_id
      where a.final_result is null and a.matches and a.case_version=r.version and a.claim_generation=r.claim_generation
      and a.reviewer_id=r.claimed_by and r.claim_expires_at>statement_timestamp()
      and a.claim_nonce_digest=encode(sha256(convert_to(r.claim_nonce::text,'UTF8')),'hex')
      and a.artifact_id=(case a.purpose when 'id_front' then r.id_artifact_id else r.selfie_artifact_id end))
    into rows,total;
  if jsonb_array_length(rows)>1400 then raise exception 'narrow the identity queue selection' using errcode='PT409';end if;
  perform internal.staff_actor('case:claim');
  return jsonb_build_object('account_id',actor,'total_steps',total,'groups',rows);
end$function$;
alter function internal.get_frontend_staff_verification_queue(integer,uuid[]) owner to postgres;
revoke all on function internal.get_frontend_staff_verification_queue(integer,uuid[]) from public;
grant execute on function internal.get_frontend_staff_verification_queue(integer,uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION internal.process_frontend_privacy_request(p_case uuid, p_revision integer, p_action text, p_note text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_attestation text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;rule private.privacy_request_rules;now_at timestamptz;
  answer text;delivery text;note text;verified_subject uuid;matches integer;
begin
  if p_action is null or p_action not in('assign','extend','verify_identity','approve','reject','complete')
    or p_revision is null or p_revision not between 1 and 2147483646 then raise exception 'represented privacy request required' using errcode='22023';end if;
  if p_note is not null then note:=internal.privacy_text(p_note,1,2000);end if;
  select * into r from private.privacy_requests where id=p_case for update;
  if not found or r.revision<>p_revision or r.status not in('submitted','identity_pending','in_progress') then raise exception 'privacy request changed' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');now_at:=clock_timestamp();
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must process your request' using errcode='42501';end if;
  if p_action='assign' then
    if p_assignee is not null and (p_assignee=r.subject_user_id or not exists(
      select 1 from private.staff_roles s join private.staff_capabilities c on c.role=s.role and c.capability='dsar:manage'
      join private.current_account_access a on a.id=s.user_id join auth.users u on u.id=s.user_id
      where s.user_id=p_assignee and s.revoked_at is null and lower(u.email)<>lower(r.requester_email)))
      then raise exception 'eligible staff assignee required' using errcode='22023';end if;
    update private.privacy_requests set assigned_to=p_assignee,revision=revision+1 where id=r.id;
    answer:=case when p_assignee is null then 'unassigned' else 'assigned' end;
  elsif p_action='extend' then
    select * into rule from private.privacy_request_rules where request_type=r.type;
    if rule.extension_days=0 or r.extended_due_at is not null or r.due_by<=now_at then raise exception 'deadline cannot be extended' using errcode='PT409';end if;
    note:=internal.privacy_text(p_note,10,1000);
    r.extended_due_at:=r.due_by+make_interval(days=>rule.extension_days);
    update private.privacy_requests set extended_due_at=r.extended_due_at,extension_reason=note,processed_by=actor,revision=revision+1 where id=r.id;
    answer:='extended';delivery:=answer;
  elsif p_action='verify_identity' then
    if r.identity_verified then raise exception 'identity was already reviewed' using errcode='PT409';end if;
    if r.identity_check='manual' then
      select count(*),(array_agg(u.id order by u.id))[1] into matches,verified_subject from auth.users u
        where lower(u.email)=lower(r.requester_email) and u.email_confirmed_at is not null and u.deleted_at is null and not u.is_anonymous;
      if matches<>1 then verified_subject:=null;end if;
    else verified_subject:=r.subject_user_id;end if;
    update private.privacy_requests set identity_verified=true,verified_at=now_at,verified_by=actor,
      subject_user_id=verified_subject,processed_by=actor,revision=revision+1 where id=r.id;
    answer:='identity_verified';
  elsif p_action in('approve','reject') then
    if r.status not in('submitted','identity_pending') then raise exception 'privacy request already decided' using errcode='PT409';end if;
    answer:=case p_action when 'approve' then 'in_progress' else 'rejected' end;
    if answer='rejected' then delivery:=answer;end if;
    update private.privacy_requests set status=answer,response_summary=note,processed_by=actor,revision=revision+1 where id=r.id;
    -- A rejected deletion request never lets its account be erased later on
    -- its own: the rejection is recorded and a legal hold placed (20261116175757_close_and_erase_account.sql).
    if answer='rejected' and r.type='deletion' then perform internal.reject_account_erasure(r.id,actor);end if;
  else
    if r.status<>'in_progress' or not r.identity_verified then raise exception 'verified in-progress privacy request required' using errcode='PT409';end if;
    if r.type='deletion' then
      -- An account named by the request is erased first (20261116175757_close_and_erase_account.sql).
      if exists(select 1 from private.account_erasure_requests l join private.account_erasures e on e.user_id=l.user_id
          where l.request_id=r.id and e.erased_at is null) then
        raise exception 'the account is not erased yet' using errcode='PT409',detail='erasure_pending';end if;
      if r.subject_user_id is not null and not exists(select 1 from private.account_erasure_requests l where l.request_id=r.id) then
        raise exception 'order the account erasure first' using errcode='PT409',detail='erasure_required';end if;
      note:=concat_ws(E'\n\n',note,'Deletion attestation: '||internal.privacy_text(p_attestation,10,2000));
    elsif p_attestation is not null then raise exception 'attestation applies only to deletion' using errcode='22023';end if;
    update private.privacy_requests set status='completed',response_summary=note,processed_by=actor,completed_at=now_at,revision=revision+1 where id=r.id;
    answer:='completed';delivery:=answer;
  end if;
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision)
    values(r.id,actor,case answer when 'in_progress' then 'started' else answer end,p_revision);
  if delivery is not null then insert into private.privacy_notice_jobs(request_id,kind) values(r.id,delivery);end if;
  perform internal.staff_actor('dsar:manage');
  return jsonb_build_object('id',r.id,'status',answer,'due',case when answer='extended' then r.extended_due_at end);
end$function$;
alter function internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) owner to postgres;
revoke all on function internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) from public;
grant execute on function internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.export_frontend_privacy_request(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;result jsonb;
begin
  select * into r from private.privacy_requests where id=p_case for share;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or r.status not in('in_progress','completed') or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  result:=jsonb_build_object('request_id',r.id,'reference','DSAR-'||upper(left(r.id::text,8)),
    'generated_at',clock_timestamp(),'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,
    'datasets',case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end);
  perform internal.staff_actor('dsar:manage');
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision) values(r.id,actor,'exported',r.revision);
  return result;
end$function$;
alter function internal.export_frontend_privacy_request(uuid,integer) owner to postgres;
revoke all on function internal.export_frontend_privacy_request(uuid,integer) from public;
grant execute on function internal.export_frontend_privacy_request(uuid,integer) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_frontend_support_inbox(p_page integer DEFAULT 1, p_ticket uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('support:view');answer jsonb;can_update boolean;
begin
  if p_page is null or p_page not between 1 and 100000 then raise exception 'valid support page required' using errcode='22023';end if;
  can_update:=exists(select 1 from private.staff_roles s join private.staff_capabilities c on c.role=s.role and c.capability='support:update'
    where s.user_id=actor and s.revoked_at is null);
  with scope as (
    select * from private.support_tickets t where p_ticket is null or t.id=p_ticket
  ), rows as (
    select * from scope order by created_at desc,id desc limit 50 offset case when p_ticket is null then (p_page-1)*50 else 0 end
  )
  select jsonb_build_object('actor_id',actor,'total',(select count(*) from scope),'can_update',can_update,
    'new_count',(select count(*) from private.support_tickets where status='new'),
    'oldest_new_at',(select min(created_at) from private.support_tickets where status='new'),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'email',t.email,
      'message','['||t.category||'] '||t.message,'status',t.status,'revision',t.revision,'created_at',t.created_at,
      'emailActivity',coalesce((select jsonb_agg(jsonb_build_object('template',m.template,'accepted',m.accepted,'created_at',m.created_at)
        order by m.created_at,m.template) from private.support_ticket_mail m where m.ticket_id=t.id),'[]'::jsonb))
      order by t.created_at desc,t.id desc) from rows t),'[]'::jsonb)) into answer;
  perform internal.staff_actor('support:view');return answer;
end$function$;
alter function internal.get_frontend_support_inbox(integer,uuid) owner to postgres;
revoke all on function internal.get_frontend_support_inbox(integer,uuid) from public;
grant execute on function internal.get_frontend_support_inbox(integer,uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_frontend_organisation_dashboard(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();o private.organisations;viewer_role text;result jsonb;
begin
  if p_slug is null or length(p_slug) not between 3 and 60 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    then raise exception 'valid organisation slug required' using errcode='22023',detail='organisation_invalid';end if;
  select o0.* into o from private.organisations o0 join private.organisation_admins a on a.organisation_id=o0.id
    where o0.slug=p_slug and a.account_id=actor;
  if not found then return null;end if;
  perform internal.organisation_actor(o.id);
  select a.role into viewer_role from private.organisation_admins a where a.organisation_id=o.id and a.account_id=actor;
  if viewer_role is null then return null;end if;
  select jsonb_build_object('account_id',actor,'id',o.id,'slug',o.slug,'name',o.name,'viewer_role',viewer_role,
    'programme_status',o.programme_status,'starts_at',o.programme_starts_at,'ends_at',o.programme_ends_at,
    'sponsored_capacity',o.sponsored_capacity,'admin_limit',o.admin_limit,'is_public',o.is_public,
    'affiliation_wording',o.affiliation_wording,
    'applications',(select jsonb_build_object('pending',count(*) filter(where a.status='submitted'),
      'moreInfo',count(*) filter(where a.status='more_info_required'),'approved',count(*) filter(where a.status='approved'),
      'declined',count(*) filter(where a.status='declined')) from private.organisation_applications a where a.organisation_id=o.id),
    'public_contacts',coalesce((select jsonb_agg(jsonb_build_object('application_id',a.id,
      'phone',p.contacts->>'phone','email',p.data->>'email','website',p.data->>'website')
      order by a.created_at desc,a.id)
      from (select x.id,x.post_id,x.created_at from private.organisation_applications x
        where x.organisation_id=o.id and x.status<>'withdrawn'
        order by x.created_at desc,x.id limit 200)a
      join private.public_eligible_posts e on e.id=a.post_id
      join private.post_presentations p on p.post_id=e.id),'[]'::jsonb),
    'affiliated',(select count(*) from private.organisation_affiliations a where a.organisation_id=o.id and a.status='active'),
    'admins',coalesce((select jsonb_agg(jsonb_build_object('user_id',a.account_id,'role',a.role,'display_name',p.display_name)
      order by a.created_at,a.account_id) from private.organisation_admins a left join private.profiles p on p.account_id=a.account_id
      where a.organisation_id=o.id),'[]'::jsonb)
  ) into result;
  perform internal.price_draft_actor();
  if not exists(select 1 from private.organisation_admins a where a.organisation_id=o.id and a.account_id=actor and a.role=viewer_role)
    then return null;end if;
  return result;
end$function$;
alter function internal.get_frontend_organisation_dashboard(text) owner to postgres;
revoke all on function internal.get_frontend_organisation_dashboard(text) from public;
grant execute on function internal.get_frontend_organisation_dashboard(text) to authenticated;


delete from private.notification_dismissals d using private.notifications n
  where d.notification_id=n.id and n.kind in('privacy_request_approved','privacy_export_made');
delete from private.notifications where kind in('privacy_request_approved','privacy_export_made');
delete from private.privacy_notice_jobs where kind in('approved','exported');
alter table private.notifications drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind = any (array['enquiry_received','organisation_application_received','organisation_application_decided','organisation_affiliation_ended','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned','identity_accepted','verification_phone_confirmed','payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','draft_deletion_warning','post_deleted','post_sold','post_kept','slot_renewal_reminder','post_approved','post_rejected','post_changes_approved','post_changes_rejected','invoice_issued','content_restored']));
alter table private.privacy_notice_jobs drop constraint privacy_notice_jobs_kind_check,
  add constraint privacy_notice_jobs_kind_check check (kind = any (array['submitted','extended','rejected','completed']));

do $$begin
  if false
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_business_review_queue(text)')) is distinct from 'afa2682424091858300bd050cd6d5703'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_seen_queue(text)')) is distinct from '81c4f1cdd36754f5faf365abab0cb136'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_seen_case(uuid)')) is distinct from '2c8bbc78d69a047bb8dbc5b645c82d03'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_cipc_case(uuid)')) is distinct from '53c819e3ac10ef4cdb5727c2e2222b9c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.staff_verification_queue(integer)')) is distinct from '9ec9ce3e17e200f53b4fdeb0da922901'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_staff_verification_queue(integer,uuid[])')) is distinct from '6443fe7d593913d62aef9b868453fe18'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text)')) is distinct from '989e334ff4fecc3ce76132277e2ea13c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.export_frontend_privacy_request(uuid,integer)')) is distinct from 'e055b06c73169fd22e15fef574c0497b'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_support_inbox(integer,uuid)')) is distinct from '607e36e4c31fd96147b4b8d1d5155095'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_organisation_dashboard(text)')) is distinct from '8823a5e28eac986cbc4df251b0c47183'
    or to_regprocedure('internal.reveal_organisation_applicant_contact(uuid)') is not null
    or to_regprocedure('api.reveal_organisation_applicant_contact(uuid)') is not null
    or (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','content_restored','draft_deletion_warning','enquiry_received','identity_accepted','invoice_issued','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','payment_completed','payment_reconciliation_required','payment_reversed','post_approved','post_changes_approved','post_changes_rejected','post_deleted','post_expired','post_kept','post_rejected','post_sold','slot_renewal_reminder','trial_started','verification_phone_confirmed','verification_returned']::text[]
    or (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.privacy_notice_jobs'::regclass and c.conname='privacy_notice_jobs_kind_check') is distinct from array['completed','extended','rejected','submitted']::text[] then
    raise exception 'staff data minimisation rollback incomplete';
  end if;
end$$;

notify pgrst,'reload schema';
commit;
