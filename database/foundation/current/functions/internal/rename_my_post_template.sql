-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.rename_my_post_template(p_template uuid, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); clean text := btrim(p_name); renamed uuid;
begin
  if clean is null or char_length(clean) not between 1 and 60 or clean ~ '[[:cntrl:]]' then
    raise exception 'template name 1 to 60 characters' using errcode='22023', detail='template_name_invalid'; end if;
  perform internal.lock_evidence_subject(actor);
  if exists(select 1 from private.post_templates t where t.owner_id = actor and lower(t.name) = lower(clean)
      and t.id is distinct from p_template) then
    raise exception 'template name already used' using errcode='PT409', detail='template_name_taken'; end if;
  update private.post_templates t set name = clean, updated_at = statement_timestamp()
    where t.id = p_template and t.owner_id = actor returning t.id into renamed;
  if renamed is null then
    raise exception 'template unavailable' using errcode='PT404', detail='template_unavailable'; end if;
  perform internal.price_draft_actor();
  return jsonb_build_object('id', renamed, 'name', clean);
end;
$function$;
alter function internal.rename_my_post_template(uuid,text) owner to postgres;
revoke all on function internal.rename_my_post_template(uuid,text) from public;
grant execute on function internal.rename_my_post_template(uuid,text) to authenticated;
