-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reference_catalog()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'version', v.version,
    'content_hash', v.content_hash,
    'categories', (select jsonb_agg(jsonb_build_object('key', c.key, 'kind', c.kind, 'area', c.area,
        'label', c.label, 'activity_required', c.activity_required) order by c.sort_order)
      from private.categories c where c.reference_version = v.version),
    'activities', (select jsonb_agg(jsonb_build_object('category', a.category_key, 'key', a.key,
        'label', a.label, 'field_group', a.field_group) order by a.sort_order)
      from private.category_activities a),
    'provinces', (select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'label', p.label)
        order by p.sort_order) from private.provinces p),
    'cities', (select jsonb_agg(jsonb_build_object('id', c.id, 'province', c.province_id, 'label', c.label)
        order by c.sort_order) from private.cities c),
    'fields', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('category', f.category_key,
        'key', f.key, 'label', f.label, 'renderer', f.renderer, 'required', f.required,
        'options', f.options, 'unit', f.unit, 'facet', f.facet_kind)) order by f.sort_order)
      from private.category_fields f)
  )
  from private.reference_catalog_versions v
  order by v.version desc limit 1;
$function$;
alter function internal.reference_catalog() owner to postgres;
revoke all on function internal.reference_catalog() from public;
grant execute on function internal.reference_catalog() to anon;
grant execute on function internal.reference_catalog() to authenticated;
