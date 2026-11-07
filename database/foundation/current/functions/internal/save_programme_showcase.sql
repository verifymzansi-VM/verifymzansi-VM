-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_programme_showcase(p_org uuid, p_showcase uuid, p_expected_revision integer, p_title text, p_placement text, p_enabled boolean, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_max_cards integer, p_display_order integer, p_sponsored_only boolean, p_reason text, p_province text, p_city text, p_programme uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage'); x private.programme_showcases;
begin
  perform internal.organisation_reason(p_reason);
  perform 1 from private.organisations o where o.id=p_org for update;
  if not found then raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable'; end if;
  actor:=internal.staff_actor('organisation:manage');
  if p_title is null or not internal.plain_text_valid(p_title,3,120,false)
    or p_placement is null or p_placement not in('home','business','tourism','market')
    or p_enabled is null or p_sponsored_only is null or p_starts_at is null or p_ends_at is null
    or p_ends_at<=p_starts_at or p_ends_at>p_starts_at+interval '366 days'
    or p_max_cards is null or p_max_cards not between 3 and 48
    or p_display_order is null or p_display_order not between 0 and 100000
    or (p_city is not null and not exists(select 1 from private.cities c where c.id=p_city
      and (p_province is null or c.province_id=p_province)))
    or (p_province is not null and not exists(select 1 from private.provinces v where v.id=p_province))
    or (p_programme is not null and not exists(select 1 from private.organisation_programmes g
      where g.id=p_programme and g.organisation_id=p_org)) then
    raise exception 'invalid showcase' using errcode='22023',detail='showcase_invalid'; end if;
  if p_showcase is null then
    if (select count(*) from private.programme_showcases s where s.organisation_id=p_org)>=20 then
      raise exception 'showcase limit reached' using errcode='PT409',detail='showcase_limit'; end if;
    insert into private.programme_showcases(organisation_id,programme_id,title,placement,enabled,starts_at,ends_at,
        max_cards,province_id,city_id,display_order,sponsored_only,created_by)
      values(p_org,p_programme,p_title,p_placement,p_enabled,p_starts_at,p_ends_at,p_max_cards,p_province,p_city,
        p_display_order,p_sponsored_only,actor) returning * into x;
  else
    update private.programme_showcases set programme_id=p_programme,title=p_title,placement=p_placement,
        enabled=p_enabled,starts_at=p_starts_at,ends_at=p_ends_at,max_cards=p_max_cards,province_id=p_province,
        city_id=p_city,display_order=p_display_order,sponsored_only=p_sponsored_only,revision=revision+1,
        updated_at=statement_timestamp()
      where id=p_showcase and organisation_id=p_org and revision=p_expected_revision returning * into x;
    if not found then
      if exists(select 1 from private.programme_showcases s where s.id=p_showcase and s.organisation_id=p_org) then
        raise exception 'showcase changed' using errcode='PT409',detail='showcase_changed'; end if;
      raise exception 'showcase not found' using errcode='PT404',detail='showcase_unavailable';
    end if;
  end if;
  perform internal.record_organisation_event(p_org,actor,'showcase_saved',x.id,p_reason);
  return jsonb_build_object('id',x.id,'revision',x.revision);
end;
$function$;
alter function internal.save_programme_showcase(uuid,uuid,integer,text,text,boolean,timestamp with time zone,timestamp with time zone,integer,integer,boolean,text,text,text,uuid) owner to postgres;
revoke all on function internal.save_programme_showcase(uuid,uuid,integer,text,text,boolean,timestamp with time zone,timestamp with time zone,integer,integer,boolean,text,text,text,uuid) from public;
grant execute on function internal.save_programme_showcase(uuid,uuid,integer,text,text,boolean,timestamp with time zone,timestamp with time zone,integer,integer,boolean,text,text,text,uuid) to authenticated;
