-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.correct_frontend_cipc_office(p_case uuid, p_expected timestamp with time zone, p_generation text, p_nonce uuid, p_office jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('evidence:view');x private.frontend_business_checks;c private.evidence_cases;
  province text;city text;verified_city text;street jsonb;
begin
  x:=internal.lock_frontend_cipc_case(p_case);actor:=internal.staff_actor('evidence:view');
  if actor=x.owner_id or x.kind<>'cipc' then raise exception 'independent official CIPC review required' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected then raise exception 'represented CIPC case changed' using errcode='PT409';end if;
  select * into c from private.evidence_cases where id=x.id;
  perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  if p_office is null or jsonb_typeof(p_office)<>'object' or octet_length(p_office::text)>6000
    or exists(select 1 from jsonb_object_keys(p_office) k where k not in('streetLines','suburb','city','province','postalCode'))
    or jsonb_typeof(p_office->'streetLines') is distinct from 'array' or jsonb_array_length(p_office->'streetLines')>3
    or (p_office->>'postalCode' is not null and p_office->>'postalCode' !~ '^[0-9]{4}$')
    then raise exception 'valid registered office required' using errcode='22023';end if;
  select p.label into province from private.provinces p where lower(p.label)=lower(p_office->>'province');
  if province is null then raise exception 'choose a recognised South African province' using errcode='22023';end if;
  city:=internal.privacy_text(p_office->>'city',1,80);
  select c2.label into verified_city from private.cities c2 join private.provinces p on p.id=c2.province_id
    where p.label=province and lower(c2.label)=lower(city) order by c2.id limit 1;
  select coalesce(jsonb_agg(internal.privacy_text(t.value,1,120) order by t.n),'[]'::jsonb) into street
    from jsonb_array_elements_text(p_office->'streetLines') with ordinality t(value,n);
  update private.frontend_cipc_reviews set office_override=jsonb_build_object('streetLines',street,'city',coalesce(verified_city,city),
    'province',province,'postalCode',p_office->>'postalCode','cityKnown',verified_city is not null,
    'suburb',case when nullif(p_office->>'suburb','') is not null then internal.privacy_text(p_office->>'suburb',1,80) end)
    where check_id=x.id;
  update private.frontend_business_checks set updated_at=clock_timestamp() where id=x.id;
  perform internal.staff_actor('evidence:view');return jsonb_build_object('ok',true);
end$function$;
alter function internal.correct_frontend_cipc_office(uuid,timestamp with time zone,text,uuid,jsonb) owner to postgres;
revoke all on function internal.correct_frontend_cipc_office(uuid,timestamp with time zone,text,uuid,jsonb) from public;
grant execute on function internal.correct_frontend_cipc_office(uuid,timestamp with time zone,text,uuid,jsonb) to authenticated;
