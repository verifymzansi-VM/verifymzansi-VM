-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_my_post_template(p_name text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); clean text := btrim(p_name); saved private.post_templates;
  replaced boolean; bad boolean;
begin
  if clean is null or char_length(clean) not between 1 and 60 or clean ~ '[[:cntrl:]]' then
    raise exception 'template name 1 to 60 characters' using errcode='22023', detail='template_name_invalid'; end if;
  -- Only the fields the plan keeps: no photos, video, title, prices, numbers
  -- or details that belong to one item (year, mileage, colour and the like);
  -- details are text, yes/no or lists of text; contact buttons by name only.
  -- Checked in steps, so each step only reads a shape the one before allowed.
  bad := jsonb_typeof(p_data) is distinct from 'object';
  if not bad then
    bad := octet_length(p_data::text) > 16384
      or jsonb_typeof(p_data->'category') is distinct from 'string' or p_data->>'category' = ''
      or exists(select 1 from jsonb_each(p_data) f where f.key not in
        ('category','condition','categoryAttributes','description','province','city','town','address','contactMethods')
        or (f.key not in ('categoryAttributes','contactMethods') and jsonb_typeof(f.value) <> 'string'))
      or jsonb_typeof(coalesce(p_data->'categoryAttributes', '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(p_data->'contactMethods', '[]'::jsonb)) <> 'array';
  end if;
  if not bad then
    bad := coalesce(p_data->'categoryAttributes', '{}'::jsonb) ?| array['year','mileage_km','number_of_owners',
        'battery_health_pct','colour','accident_free','registration_province','available_from',
        'application_deadline','age_months','quantity','monthly_rent_zar','salary_min','salary_max','levy_zar',
        'rates_taxes_zar']
      or exists(select 1 from jsonb_each(coalesce(p_data->'categoryAttributes', '{}'::jsonb)) a
        where case jsonb_typeof(a.value) when 'string' then false when 'boolean' then false
          when 'array' then exists(select 1 from jsonb_array_elements(a.value) e where jsonb_typeof(e) <> 'string')
          else true end)
      or exists(select 1 from jsonb_array_elements(coalesce(p_data->'contactMethods', '[]'::jsonb)) c
        where c not in ('"call"','"whatsapp"','"in_app"'));
  end if;
  if bad then
    raise exception 'template details invalid' using errcode='22023', detail='template_invalid'; end if;
  perform internal.lock_evidence_subject(actor);
  if not exists(select 1 from internal.slot_package_now(actor)) then
    raise exception 'templates need a running Multi-listing package' using errcode='PT402', detail='package_required'; end if;
  update private.post_templates t set name = clean, data = p_data, updated_at = statement_timestamp()
    where t.owner_id = actor and lower(t.name) = lower(clean)
    returning * into saved;
  replaced := found;
  if not replaced then
    if (select count(*) from private.post_templates t where t.owner_id = actor) >= 20 then
      raise exception 'up to 20 templates' using errcode='PT429', detail='template_limit'; end if;
    insert into private.post_templates(owner_id, name, data) values (actor, clean, p_data) returning * into saved;
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', saved.id, 'name', saved.name, 'replaced', replaced);
end;
$function$;
alter function internal.save_my_post_template(text,jsonb) owner to postgres;
revoke all on function internal.save_my_post_template(text,jsonb) from public;
grant execute on function internal.save_my_post_template(text,jsonb) to authenticated;
