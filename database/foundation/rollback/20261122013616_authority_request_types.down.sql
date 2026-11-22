-- Reviewed rollback for updates/20261122013616_authority_request_types.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. It refuses unless the update is
-- applied, and refuses while any disclosure was opened under rule D9 (it has
-- the issuing court or station, the number called and who confirmed it):
-- authority request records are kept, and these columns hold part of them.
-- Otherwise it puts back the four functions byte for byte as they were before
-- the update, drops api.open_authority_request and its internal twin, and
-- removes the three columns and the confirmation check, restoring the earlier
-- request type check. Earlier disclosure rows stay as they are.
begin;
set local lock_timeout='5s';
-- No new disclosure may be opened while this rollback checks and runs.
lock table private.identity_disclosures in share row exclusive mode;

do $$
declare fn record;
begin
  for fn in select * from (values
      ('internal.open_identity_disclosure(text,text,text,text,text,boolean)','1e94be28e68801c02330175c4b28135d'),
      ('internal.read_identity_disclosure(uuid,text,uuid)','63782df66dd597f8ab846179fdeb60d0'),
      ('internal.identity_disclosure_record(private.identity_disclosures,uuid)','9b87eb6989c9c4c1ae4c524f71ab948f'),
      ('internal.identity_disclosure_material(uuid,uuid)','31e6fa632182fb300b5a8ba511ca2208')
    ) v(sig,updated) loop
    if coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure(fn.sig)),'missing')
        <> fn.updated then
      raise exception 'rollback precondition: the authority request types update is not applied (%)', fn.sig using errcode='55000';
    end if;
  end loop;
  if to_regprocedure('api.open_authority_request(text,text,text,text,text,text,text,text,boolean)') is null
      or (select count(*) from pg_attribute where attrelid='private.identity_disclosures'::regclass
        and attname in ('issued_by','confirmed_number','confirmed_by') and not attisdropped)<>3 then
    raise exception 'rollback precondition: the authority request types update is not applied' using errcode='55000';
  end if;
  if exists(select 1 from private.identity_disclosures d where to_jsonb(d)->>'issued_by' is not null) then
    raise exception 'rollback refused: disclosures were opened under rule D9 and are kept' using errcode='55000';
  end if;
end$$;

-- The four functions as they were before the update.
CREATE OR REPLACE FUNCTION internal.open_identity_disclosure(p_request_type text, p_reference text, p_reason text, p_lookup_kind text, p_lookup_value text, p_attested boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('identity:disclose');
  v_value text; post uuid; matched uuid[]; outcome text; made timestamptz; d private.identity_disclosures;
begin
  if p_request_type is null or p_request_type not in ('subpoena','court_order','warrant','police_case','regulator') then
    raise exception 'valid request type required' using errcode='22023',detail='disclosure_request_type_invalid'; end if;
  if not internal.identity_disclosure_text_ok(p_reference,3,100) then
    raise exception 'request reference required' using errcode='22023',detail='disclosure_reference_required'; end if;
  if not internal.identity_disclosure_text_ok(p_reason,10,2000) then
    raise exception 'reason required' using errcode='22023',detail='disclosure_reason_required'; end if;
  if p_attested is distinct from true then
    raise exception 'confirm that the request is genuine and signed' using errcode='22023',detail='disclosure_attestation_required'; end if;
  -- Never by name: only these four kinds exist.
  if p_lookup_kind is null or p_lookup_kind not in ('post','id_number','phone','email') then
    raise exception 'search by post link, ID number, phone or email' using errcode='22023',detail='disclosure_lookup_invalid'; end if;
  v_value:=btrim(p_lookup_value);
  if p_lookup_kind='email' then v_value:=lower(v_value); end if;
  if v_value is null or not (case p_lookup_kind
      when 'post' then v_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or v_value ~ '^[a-z0-9-]{3,60}$'
      when 'id_number' then v_value ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      when 'phone' then v_value ~ '^[+]27[0-9]{9}$'
      else length(v_value)<=254 and v_value ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' end) then
    raise exception 'valid search value required' using errcode='22023',detail='disclosure_lookup_value_invalid'; end if;


  if p_lookup_kind='post' then
    if v_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then post:=v_value::uuid;
    else select s.post_id into post from private.post_slugs s where s.slug=v_value; end if;
    select coalesce(array_agg(p.owner_id),'{}') into matched from private.posts p where p.id=post;
  elsif p_lookup_kind='id_number' then
    select coalesce(array_agg(x.owner_id order by x.last_at desc, x.owner_id),'{}') into matched
      from (select f.owner_id,max(f.reviewed_at) last_at from private.accepted_identity_facts f
        where f.identity_hmac=v_value group by f.owner_id) x;
    if cardinality(matched)=0 then
      select coalesce(array_agg(x.owner_id order by x.last_at desc, x.owner_id),'{}') into matched
        from (select s.owner_id,max(s.created_at) last_at from private.verification_identity_submissions s
          where s.identity_hmac=v_value group by s.owner_id) x;
      outcome:=case when cardinality(matched)>0 then 'attempt_only' end;
    end if;
  elsif p_lookup_kind='phone' then
    select coalesce(array_agg(x.owner_id order by x.last_at desc, x.owner_id),'{}') into matched
      from (select v.owner_id,max(v.verified_at) last_at from private.verification_phone_proofs v
        where v.phone=v_value group by v.owner_id) x;
  else
    select coalesce(array_agg(u.id order by u.id),'{}') into matched from auth.users u where lower(u.email)=v_value;
  end if;
  if outcome is null then
    outcome:=case when cardinality(matched)=0 then 'no_match'
      when exists(select 1 from private.accepted_identity_facts f where f.owner_id=any(matched[1:5])) then 'record'
      else 'no_record' end;
  end if;

  -- The log row is written before anything about the person is answered.
  made:=clock_timestamp();
  insert into private.identity_disclosures(opened_by,opened_at,closes_at,request_type,
      request_reference,reason,attested,lookup_kind,lookup_value,outcome,subject_ids,match_count)
    values(actor,made,made+interval '15 minutes',p_request_type,
      btrim(p_reference),btrim(p_reason),true,p_lookup_kind,v_value,outcome,
      matched[1:5],cardinality(matched))
    returning * into d;
  perform internal.staff_actor('identity:disclose');
  return jsonb_build_object('disclosure_id',d.id,'number',d.number,'outcome',d.outcome,
    'match_count',d.match_count,'closes_at',d.closes_at);
end;
$function$;
alter function internal.open_identity_disclosure(text,text,text,text,text,boolean) owner to postgres;
revoke all on function internal.open_identity_disclosure(text,text,text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.open_identity_disclosure(text,text,text,text,text,boolean) to authenticated;

CREATE OR REPLACE FUNCTION internal.identity_disclosure_record(p_disclosure private.identity_disclosures, p_subject uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p_disclosure.outcome='attempt_only' then jsonb_build_object(
      'account_id',p_subject,'kept',false,
      'attempts',coalesce((select jsonb_agg(t.created_at order by t.created_at desc)
        from (select x.created_at from private.verification_identity_submissions x
          where x.owner_id=p_subject and x.identity_hmac=p_disclosure.lookup_value
          order by x.created_at desc limit 20) t),'[]'::jsonb))
    else coalesce((select jsonb_build_object(
      'account_id',p_subject,'kept',true,
      'account_closed_at',(select c.closed_at from private.account_closures c where c.user_id=p_subject),
      'legal_first_name',coalesce(n.legal_first_name,case when p.legal_name_fact_id=f.id then p.legal_first_name end),
      'legal_last_name',coalesce(n.legal_last_name,case when p.legal_name_fact_id=f.id then p.legal_last_name end),
      'verified_at',f.reviewed_at,
      'verification_revoked_at',f.revoked_at,
      'checked_by',case s.recipe when 'manual-id-selfie-v1' then 'staff_review' else 'other' end,
      'id_number_kept',s.number_erased_at is null,
      'id_number_erased_at',s.number_erased_at,
      'selfie',jsonb_build_object('kept',coalesce(sa.state in ('uploaded','clean'),false),'taken_at',sa.created_at,
        'deleted_at',case when sa.state not in ('uploaded','clean') then coalesce(sa.deleted_at,sa.state_changed_at) end),
      'id_photo',jsonb_build_object('kept',coalesce(ia.state in ('uploaded','clean'),false),'taken_at',ia.created_at,
        'deleted_at',case when ia.state not in ('uploaded','clean') then coalesce(ia.deleted_at,ia.state_changed_at) end),
      'phones',coalesce((select jsonb_agg(jsonb_build_object('phone',v.phone,'verified_at',v.verified_at,
          'revoked_at',v.revoked_at) order by v.verified_at desc)
        from (select y.phone,y.verified_at,y.revoked_at from private.verification_phone_proofs y
          where y.owner_id=p_subject order by y.verified_at desc limit 20) v),'[]'::jsonb))
      from private.accepted_identity_facts f
      join private.verification_identity_submissions s on s.id=f.submission_id and s.owner_id=f.owner_id
      left join private.identity_submission_names n on n.submission_id=s.id
      left join private.profiles p on p.account_id=f.owner_id
      left join private.evidence_artifacts sa on sa.id=s.selfie_artifact_id
      left join private.evidence_artifacts ia on ia.id=s.id_artifact_id
      where f.owner_id=p_subject
      order by f.reviewed_at desc, f.id desc limit 1),
      jsonb_build_object('account_id',p_subject,'kept',false,
        'account_closed_at',(select c.closed_at from private.account_closures c where c.user_id=p_subject)))
  end;
$function$;
alter function internal.identity_disclosure_record(private.identity_disclosures,uuid) owner to postgres;
revoke all on function internal.identity_disclosure_record(private.identity_disclosures,uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.read_identity_disclosure(p_disclosure uuid, p_purpose text, p_subject uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('identity:disclose'); d private.identity_disclosures; records jsonb;
begin
  if p_purpose is null or p_purpose not in ('view','print','selfie') then
    raise exception 'valid purpose required' using errcode='22023',detail='disclosure_purpose_invalid'; end if;
  if p_disclosure is null or (p_purpose='selfie')<>(p_subject is not null) then
    raise exception 'valid disclosure required' using errcode='22023',detail='disclosure_subject_invalid'; end if;
  d:=internal.identity_disclosure_open_for(p_disclosure,actor);
  if p_subject is not null and (d.outcome<>'record' or not p_subject=any(d.subject_ids)) then
    raise exception 'valid disclosure required' using errcode='22023',detail='disclosure_subject_invalid'; end if;
  -- The look is logged before anything is answered.
  insert into private.identity_disclosure_events(disclosure_id,staff_id,kind,subject_id)
    values(d.id,actor,case p_purpose when 'view' then 'viewed' when 'print' then 'printed' else 'selfie_viewed' end,p_subject);
  select coalesce(jsonb_agg(internal.identity_disclosure_record(d,u.subject) order by u.ord),'[]'::jsonb) into records
    from unnest(d.subject_ids) with ordinality u(subject,ord)
    where p_subject is null or u.subject=p_subject;
  perform internal.staff_actor('identity:disclose');
  return jsonb_build_object(
    'disclosure',jsonb_build_object('id',d.id,'number',d.number,'opened_at',d.opened_at,'closes_at',d.closes_at,
      'opened_by_name',(select internal.profile_public_name(p.display_name) from private.profiles p where p.account_id=d.opened_by),
      'request_type',d.request_type,'reference',d.request_reference,'reason',d.reason,
      'lookup_kind',d.lookup_kind,
      'lookup_value',case when d.lookup_kind='id_number' then null else d.lookup_value end,
      'outcome',d.outcome,'match_count',d.match_count),
    'records',records);
end;
$function$;
alter function internal.read_identity_disclosure(uuid,text,uuid) owner to postgres;
revoke all on function internal.read_identity_disclosure(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.read_identity_disclosure(uuid,text,uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.identity_disclosure_material(p_disclosure uuid, p_staff uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare d private.identity_disclosures; records jsonb:='[]'::jsonb;
begin
  if p_disclosure is null or p_staff is null then
    raise exception 'disclosure and staff member required' using errcode='22023'; end if;
  d:=internal.identity_disclosure_open_for(p_disclosure,p_staff);
  if d.outcome='record' then
    select coalesce(jsonb_agg(x.material order by u.ord),'[]'::jsonb) into records
      from unnest(d.subject_ids) with ordinality u(subject,ord)
      cross join lateral (select jsonb_build_object('account_id',f.owner_id,'submission_id',s.id,
          'encrypted_number',case when s.number_erased_at is null then jsonb_build_object('ciphertext',s.number_ciphertext,
            'iv',s.number_iv,'tag',s.number_tag,'key_id',s.encryption_key_id) end,
          'selfie',case when a.state in ('uploaded','clean') and a.sha256 is not null and a.size_bytes is not null
            then jsonb_build_object('artifact_id',a.id,'case_id',a.case_id,'object_key',a.object_key,
              'sha256',a.sha256,'size_bytes',a.size_bytes) end) material
        from private.accepted_identity_facts f
        join private.verification_identity_submissions s on s.id=f.submission_id and s.owner_id=f.owner_id
        left join private.evidence_artifacts a on a.id=s.selfie_artifact_id
        where f.owner_id=u.subject
        order by f.reviewed_at desc, f.id desc limit 1) x;
  end if;
  return jsonb_build_object('disclosure_id',d.id,'records',records);
end;
$function$;
alter function internal.identity_disclosure_material(uuid,uuid) owner to postgres;
revoke all on function internal.identity_disclosure_material(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.identity_disclosure_material(uuid,uuid) to service_role;

-- The new command, then the columns and checks.
drop function api.open_authority_request(text,text,text,text,text,text,text,text,boolean);
drop function internal.open_authority_request(text,text,text,text,text,text,text,text,boolean);
alter table private.identity_disclosures drop constraint identity_disclosures_confirmation_check;
alter table private.identity_disclosures drop constraint identity_disclosures_request_type_check;
alter table private.identity_disclosures add constraint identity_disclosures_request_type_check
  check (request_type in ('subpoena','court_order','warrant','police_case','regulator'));
alter table private.identity_disclosures
  drop column issued_by,
  drop column confirmed_number,
  drop column confirmed_by;

commit;
