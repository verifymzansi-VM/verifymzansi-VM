-- Authority requests under rule D9: a kept identity record is opened only for
-- a subpoena (Criminal Procedure Act s205, issued by a magistrate or judge), a
-- court order or a search warrant, each checked with the issuing court or the
-- named prosecutor on an official number; or for an urgent written SAPS
-- request where a life is at risk, checked by calling the station. An urgent
-- request gives only the minimum: never the selfie or the ID photo.
--
-- From this update:
-- 1. private.identity_disclosures gains three columns: issued_by (the court,
--    or the SAPS station), confirmed_number (the official number that was
--    called) and confirmed_by (who confirmed the request on that call). Rows
--    opened before this update keep them empty and keep their request type
--    (warrant, police_case and regulator stay readable); nothing is rewritten.
--    A check makes every row either an earlier one (no confirmation, an
--    earlier type) or a D9 one (all three filled, one of the four D9 types).
-- 2. New api.open_authority_request(type, reference, issued_by,
--    confirmed_number, confirmed_by, reason, lookup kind, lookup value,
--    attested): the type is subpoena, court_order, search_warrant or
--    urgent_life_risk; the reference is the subpoena, warrant or case number
--    (3 to 100 characters); issued_by and confirmed_by take 3 to 120
--    characters, the number 5 to 20 digits and spaces (an optional leading +).
--    Each missing part is refused with 22023 and its own detail:
--    disclosure_issued_by_required, disclosure_confirmed_number_required,
--    disclosure_confirmed_by_required. Everything else (staff rule, search,
--    log before show) is as in api.open_identity_disclosure.
-- 3. api.open_identity_disclosure keeps its signature and grants but now
--    passes its request through the same rule with no confirmation, so it is
--    always refused (an earlier type with disclosure_request_type_invalid, a
--    D9 type with disclosure_issued_by_required). It is removed in a later
--    contract step.
-- 4. For an urgent_life_risk request:
--    - api.read_identity_disclosure leaves the selfie and ID photo out of each
--      record (only the names, ID number state, verified phones and dates),
--      and refuses the purpose 'selfie' with 22023 detail
--      disclosure_selfie_withheld before anything is logged;
--    - api.identity_disclosure_material never returns the selfie's object
--      (the encrypted ID number still, for the website to show the number).
-- 5. api.read_identity_disclosure adds issued_by, confirmed_number and
--    confirmed_by to the disclosure only when the row has them, so a website
--    release without the matching code still reads every earlier row.
--
-- Expand only: one new command; no argument or command is removed or
-- renamed. ORDER: apply first, then merge. Between the two, the live website
-- cannot open a new record (its form has no confirmation fields); records
-- opened before still read as they did.
-- Read-only preflight: ../preflight/20261122013616_authority_request_types.check.sql.
-- Rollback: ../rollback/20261122013616_authority_request_types.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: the four replaced functions have their reviewed bodies (or
-- this update's), and nothing of this update exists yet, or all of it does.
do $$
declare present integer; fn record;
begin
  for fn in select * from (values
      ('internal.open_identity_disclosure(text,text,text,text,text,boolean)','b72391179f1d942af39f268d5a8a812c','1e94be28e68801c02330175c4b28135d'),
      ('internal.read_identity_disclosure(uuid,text,uuid)','7f80eff0035ca2abfdaea6cf32712e2c','63782df66dd597f8ab846179fdeb60d0'),
      ('internal.identity_disclosure_record(private.identity_disclosures,uuid)','28da9a89df24f4b133f1419725fbd084','5a0e0e7fff209f40dd93f8fdc71ecccd'),
      ('internal.identity_disclosure_material(uuid,uuid)','83fa3856da8d655a03cc5137c75c1625','31e6fa632182fb300b5a8ba511ca2208')
    ) v(sig,reviewed,updated) loop
    if coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure(fn.sig)),'missing')
        not in (fn.reviewed,fn.updated) then
      raise exception 'authority request types drift: % is not the reviewed body', fn.sig using errcode='55000';
    end if;
  end loop;
  select (to_regprocedure('api.open_authority_request(text,text,text,text,text,text,text,text,boolean)') is not null)::integer
    + (to_regprocedure('internal.open_authority_request(text,text,text,text,text,text,text,text,boolean)') is not null)::integer
    + (select count(*)::integer from pg_attribute where attrelid='private.identity_disclosures'::regclass
        and attname in ('issued_by','confirmed_number','confirmed_by') and not attisdropped)
    + (select count(*)::integer from pg_constraint where conrelid='private.identity_disclosures'::regclass
        and conname='identity_disclosures_confirmation_check')
  into present;
  if present not in (0, 6) then
    raise exception 'authority request types precondition: % of 6 objects exist', present using errcode='55000';
  end if;
end$$;

-- 1. Who issued the request, the official number called, who confirmed it.
alter table private.identity_disclosures
  add column if not exists issued_by text,
  add column if not exists confirmed_number text,
  add column if not exists confirmed_by text;
alter table private.identity_disclosures drop constraint if exists identity_disclosures_request_type_check;
alter table private.identity_disclosures add constraint identity_disclosures_request_type_check
  check (request_type in ('subpoena','court_order','warrant','police_case','regulator','search_warrant','urgent_life_risk'));
alter table private.identity_disclosures drop constraint if exists identity_disclosures_confirmation_check;
alter table private.identity_disclosures add constraint identity_disclosures_confirmation_check check (
  case when issued_by is null and confirmed_number is null and confirmed_by is null
    then request_type in ('subpoena','court_order','warrant','police_case','regulator')
    else coalesce(request_type in ('subpoena','court_order','search_warrant','urgent_life_risk')
      and length(issued_by) between 3 and 120 and length(confirmed_by) between 3 and 120
      and confirmed_number ~ '^[+]?[0-9][0-9 ]{3,18}[0-9]$', false) end);

-- 2. Open a record under rule D9: check the request and its confirmation,
-- find the person, log, then answer with the log row's id only.
CREATE OR REPLACE FUNCTION internal.open_authority_request(p_request_type text, p_reference text, p_issued_by text, p_confirmed_number text, p_confirmed_by text, p_reason text, p_lookup_kind text, p_lookup_value text, p_attested boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('identity:disclose');
  v_value text; post uuid; matched uuid[]; outcome text; made timestamptz; d private.identity_disclosures;
begin
  -- Rule D9: a subpoena (Criminal Procedure Act s205), a court order or a
  -- search warrant; or an urgent written SAPS request where a life is at risk.
  if p_request_type is null or p_request_type not in ('subpoena','court_order','search_warrant','urgent_life_risk') then
    raise exception 'valid request type required' using errcode='22023',detail='disclosure_request_type_invalid'; end if;
  if not internal.identity_disclosure_text_ok(p_reference,3,100) then
    raise exception 'request reference required' using errcode='22023',detail='disclosure_reference_required'; end if;
  -- Checked with whoever issued it (the court or prosecutor, or the SAPS
  -- station) on an official number: who issued it, the number, who confirmed.
  if not internal.identity_disclosure_text_ok(p_issued_by,3,120) then
    raise exception 'issuing court or police station required' using errcode='22023',detail='disclosure_issued_by_required'; end if;
  if not internal.identity_disclosure_text_ok(p_confirmed_number,5,20)
      or btrim(p_confirmed_number) !~ '^[+]?[0-9][0-9 ]{3,18}[0-9]$' then
    raise exception 'official number called required' using errcode='22023',detail='disclosure_confirmed_number_required'; end if;
  if not internal.identity_disclosure_text_ok(p_confirmed_by,3,120) then
    raise exception 'who confirmed the request required' using errcode='22023',detail='disclosure_confirmed_by_required'; end if;
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
      request_reference,issued_by,confirmed_number,confirmed_by,reason,attested,lookup_kind,lookup_value,
      outcome,subject_ids,match_count)
    values(actor,made,made+interval '15 minutes',p_request_type,
      btrim(p_reference),btrim(p_issued_by),btrim(p_confirmed_number),btrim(p_confirmed_by),
      btrim(p_reason),true,p_lookup_kind,v_value,outcome,matched[1:5],cardinality(matched))
    returning * into d;
  perform internal.staff_actor('identity:disclose');
  return jsonb_build_object('disclosure_id',d.id,'number',d.number,'outcome',d.outcome,
    'match_count',d.match_count,'closes_at',d.closes_at);
end;
$function$;
alter function internal.open_authority_request(text,text,text,text,text,text,text,text,boolean) owner to postgres;
revoke all on function internal.open_authority_request(text,text,text,text,text,text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.open_authority_request(text,text,text,text,text,text,text,text,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.open_authority_request(p_request_type text, p_reference text, p_issued_by text, p_confirmed_number text, p_confirmed_by text, p_reason text, p_lookup_kind text, p_lookup_value text, p_attested boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.open_authority_request(p_request_type,p_reference,p_issued_by,p_confirmed_number,p_confirmed_by,p_reason,p_lookup_kind,p_lookup_value,p_attested);
$function$;
alter function api.open_authority_request(text,text,text,text,text,text,text,text,boolean) owner to postgres;
revoke all on function api.open_authority_request(text,text,text,text,text,text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function api.open_authority_request(text,text,text,text,text,text,text,text,boolean) to authenticated;

-- 3. The earlier command goes through the same rule, without a
-- confirmation, so it is always refused.
CREATE OR REPLACE FUNCTION internal.open_identity_disclosure(p_request_type text, p_reference text, p_reason text, p_lookup_kind text, p_lookup_value text, p_attested boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Rule D9 needs who issued the request, the official number called and who
  -- confirmed it; this earlier command carries none of them.
  return internal.open_authority_request(p_request_type,p_reference,null,null,null,
    p_reason,p_lookup_kind,p_lookup_value,p_attested);
end;
$function$;
alter function internal.open_identity_disclosure(text,text,text,text,text,boolean) owner to postgres;
revoke all on function internal.open_identity_disclosure(text,text,text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.open_identity_disclosure(text,text,text,text,text,boolean) to authenticated;

-- 4a. What a disclosure shows about one named account; an urgent request
-- leaves out the selfie and the ID photo.
CREATE OR REPLACE FUNCTION internal.identity_disclosure_record(p_disclosure private.identity_disclosures, p_subject uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p_disclosure.request_type='urgent_life_risk' then rec.r - 'selfie' - 'id_photo' else rec.r end
  from (select case when p_disclosure.outcome='attempt_only' then jsonb_build_object(
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
  end r) rec;
$function$;
alter function internal.identity_disclosure_record(private.identity_disclosures,uuid) owner to postgres;
revoke all on function internal.identity_disclosure_record(private.identity_disclosures,uuid) from public, anon, authenticated, service_role;

-- 4b. Read an open disclosure: log the look, then answer. An urgent request
-- never shows the selfie; the confirmation is added when the row has one.
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
  -- Rule D9: an urgent request gives only the minimum, never the selfie.
  if p_purpose='selfie' and d.request_type='urgent_life_risk' then
    raise exception 'the selfie is never disclosed for an urgent request' using errcode='22023',detail='disclosure_selfie_withheld'; end if;
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
      'outcome',d.outcome,'match_count',d.match_count)
      || jsonb_strip_nulls(jsonb_build_object('issued_by',d.issued_by,'confirmed_number',d.confirmed_number,
        'confirmed_by',d.confirmed_by)),
    'records',records);
end;
$function$;
alter function internal.read_identity_disclosure(uuid,text,uuid) owner to postgres;
revoke all on function internal.read_identity_disclosure(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.read_identity_disclosure(uuid,text,uuid) to authenticated;

-- 4c. For the website's server only; an urgent request never carries the
-- selfie's stored object.
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
          'selfie',case when d.request_type<>'urgent_life_risk'
              and a.state in ('uploaded','clean') and a.sha256 is not null and a.size_bytes is not null
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

commit;
