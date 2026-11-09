-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_edit_presentation_same(p_original uuid, p_edit uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select (select jsonb_build_object('data',data,'contacts',contacts) from private.post_presentations where post_id=p_original)
    is not distinct from (select jsonb_build_object('data',data,'contacts',contacts) from private.post_presentations where post_id=p_edit)
    and coalesce((select jsonb_agg(to_jsonb(m)-'post_id' order by purpose,position) from private.post_presentation_media m where post_id=p_original),'[]'::jsonb)
      =coalesce((select jsonb_agg(to_jsonb(m)-'post_id' order by purpose,position) from private.post_presentation_media m where post_id=p_edit),'[]'::jsonb);
$function$;
alter function internal.frontend_edit_presentation_same(uuid,uuid) owner to postgres;
revoke all on function internal.frontend_edit_presentation_same(uuid,uuid) from public;
