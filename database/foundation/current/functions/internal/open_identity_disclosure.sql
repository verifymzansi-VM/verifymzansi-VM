-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.open_identity_disclosure(p_request_type text, p_reference text, p_requested_by text, p_request_date text, p_reason text, p_lookup_kind text, p_lookup_value text, p_attested boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('identity:disclose'); today date; asked date;
  v_value text; post uuid; matched uuid[]; outcome text; made timestamptz; d private.identity_disclosures;
begin
  if p_request_type is null or p_request_type not in ('subpoena','court_order','warrant','police_case','regulator') then
    raise exception 'valid request type required' using errcode='22023',detail='disclosure_request_type_invalid'; end if;
  if not internal.identity_disclosure_text_ok(p_reference,3,100) then
    raise exception 'request reference required' using errcode='22023',detail='disclosure_reference_required'; end if;
  if not internal.identity_disclosure_text_ok(p_requested_by,3,200) then
    raise exception 'who is asking required' using errcode='22023',detail='disclosure_requester_required'; end if;
  today:=(clock_timestamp() at time zone 'Africa/Johannesburg')::date;
  if p_request_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin asked:=p_request_date::date; exception when others then asked:=null; end;
  end if;
  if asked is null or asked>today or asked<today-1826 then
    raise exception 'valid request date required' using errcode='22023',detail='disclosure_request_date_invalid'; end if;
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('identity_disclosure:'||actor::text,0));
  actor:=internal.staff_actor('identity:disclose');
  if (select count(*) from private.identity_disclosures x where x.opened_by=actor
      and x.opened_at>clock_timestamp()-interval '24 hours')>=20 then
    raise exception 'too many authority request openings' using errcode='PT429',detail='disclosure_rate_limited'; end if;

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
  insert into private.identity_disclosures(opened_by,opened_session,opened_at,closes_at,request_type,
      request_reference,requested_by,request_date,reason,attested,lookup_kind,lookup_value,outcome,subject_ids,match_count)
    values(actor,(auth.jwt()->>'session_id')::uuid,made,made+interval '15 minutes',p_request_type,
      btrim(p_reference),btrim(p_requested_by),asked,btrim(p_reason),true,p_lookup_kind,v_value,outcome,
      matched[1:5],cardinality(matched))
    returning * into d;
  perform internal.staff_actor('identity:disclose');
  return jsonb_build_object('disclosure_id',d.id,'number',d.number,'outcome',d.outcome,
    'match_count',d.match_count,'closes_at',d.closes_at);
end;
$function$;
alter function internal.open_identity_disclosure(text,text,text,text,text,text,text,boolean) owner to postgres;
revoke all on function internal.open_identity_disclosure(text,text,text,text,text,text,text,boolean) from public;
grant execute on function internal.open_identity_disclosure(text,text,text,text,text,text,text,boolean) to authenticated;
