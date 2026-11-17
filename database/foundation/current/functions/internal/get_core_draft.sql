-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_core_draft(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'kind',p.kind,'area',p.area,'category_key',p.category_key,'status',p.status,'revision',p.revision)
      || case when p.activity_key is not null then jsonb_build_object('activity_key',p.activity_key) else '{}'::jsonb end
    into result from private.posts p where p.id=p_id and p.owner_id=actor and p.status='draft';
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_core_draft(uuid) owner to postgres;
revoke all on function internal.get_core_draft(uuid) from public;
grant execute on function internal.get_core_draft(uuid) to authenticated;
