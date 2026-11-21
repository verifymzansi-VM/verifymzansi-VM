-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.delete_my_post_template(p_template uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); gone uuid;
begin
  perform internal.lock_evidence_subject(actor);
  delete from private.post_templates t where t.id = p_template and t.owner_id = actor returning t.id into gone;
  if gone is null then
    raise exception 'template unavailable' using errcode='PT404', detail='template_unavailable'; end if;
  perform internal.price_draft_actor();
  return jsonb_build_object('id', gone);
end;
$function$;
alter function internal.delete_my_post_template(uuid) owner to postgres;
revoke all on function internal.delete_my_post_template(uuid) from public;
grant execute on function internal.delete_my_post_template(uuid) to authenticated;
