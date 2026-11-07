-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
