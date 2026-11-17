-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.confirm_verification_locality(p_province text, p_city text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); prior private.verification_localities;
begin
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  if not exists(select 1 from private.cities c where c.id=p_city and c.province_id=p_province) then
    raise exception 'canonical city/province pair required' using errcode='22023'; end if;
  select l.* into prior from private.verification_localities l where l.owner_id=actor;
  if found then
    if (prior.province_id,prior.city_id) is distinct from (p_province,p_city) then
      raise exception 'approved locality requires authorised resubmission' using errcode='PT409'; end if;
    return jsonb_build_object('status','approved','assurance','self_declared','province_id',p_province,'city_id',p_city,'reused',true);
  end if;
  insert into private.verification_localities(owner_id,province_id,city_id) values(actor,p_province,p_city)
  on conflict(owner_id) do update set province_id=excluded.province_id,city_id=excluded.city_id,confirmed_at=clock_timestamp();
  return jsonb_build_object('status','approved','assurance','self_declared','province_id',p_province,'city_id',p_city);
end;
$function$;
alter function internal.confirm_verification_locality(text,text) owner to postgres;
revoke all on function internal.confirm_verification_locality(text,text) from public;
grant execute on function internal.confirm_verification_locality(text,text) to authenticated;
