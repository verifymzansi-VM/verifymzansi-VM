-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
revoke all on function internal.open_authority_request(text,text,text,text,text,text,text,text,boolean) from public;
grant execute on function internal.open_authority_request(text,text,text,text,text,text,text,text,boolean) to authenticated;
