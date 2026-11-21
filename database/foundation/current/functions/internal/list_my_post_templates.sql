-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_my_post_templates()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor();
begin
  return jsonb_build_object(
    'package_running', exists(select 1 from internal.slot_package_now(actor)),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'name', t.name,
        'data', t.data, 'updated_at', t.updated_at) order by lower(t.name), t.id)
      from private.post_templates t where t.owner_id = actor), '[]'::jsonb));
end;
$function$;
alter function internal.list_my_post_templates() owner to postgres;
revoke all on function internal.list_my_post_templates() from public;
grant execute on function internal.list_my_post_templates() to authenticated;
