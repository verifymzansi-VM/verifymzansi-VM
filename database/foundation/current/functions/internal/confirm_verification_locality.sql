-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.confirm_verification_locality(p_province text, p_city text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); prior private.verification_localities; next_change timestamptz;
begin
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  if not exists(select 1 from private.cities c where c.id=p_city and c.province_id=p_province) then
    raise exception 'canonical city/province pair required' using errcode='22023'; end if;
  select l.* into prior from private.verification_localities l where l.owner_id=actor;
  if found then
    if (prior.province_id,prior.city_id) is not distinct from (p_province,p_city) then
      return jsonb_build_object('status','approved','assurance','self_declared','province_id',p_province,'city_id',p_city,'reused',true);
    end if;
    -- A member changes their place at most once every 15 days; each change
    -- is recorded (from and to) for audit.
    select max(c.changed_at)+interval '15 days' into next_change
      from private.verification_locality_changes c where c.owner_id=actor;
    if next_change>clock_timestamp() then
      raise exception 'locality change not eligible' using errcode='PT409', detail='location_change_cooldown',
        hint=to_char(next_change at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'); end if;
    insert into private.verification_locality_changes(owner_id,from_province_id,from_city_id,to_province_id,to_city_id)
      values(actor,prior.province_id,prior.city_id,p_province,p_city);
    update private.verification_localities set province_id=p_province,city_id=p_city,confirmed_at=clock_timestamp()
      where owner_id=actor;
    return jsonb_build_object('status','approved','assurance','self_declared','province_id',p_province,'city_id',p_city,'reused',false);
  end if;
  insert into private.verification_localities(owner_id,province_id,city_id) values(actor,p_province,p_city)
  on conflict(owner_id) do update set province_id=excluded.province_id,city_id=excluded.city_id,confirmed_at=clock_timestamp();
  return jsonb_build_object('status','approved','assurance','self_declared','province_id',p_province,'city_id',p_city);
end;
$function$;
alter function internal.confirm_verification_locality(text,text) owner to postgres;
revoke all on function internal.confirm_verification_locality(text,text) from public;
grant execute on function internal.confirm_verification_locality(text,text) to authenticated;
