-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.discard_post_edit(p_edit_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); original_id uuid; edit private.posts;
begin
  perform internal.assert_post_revision(p_expected_revision);
  select p.edit_of into original_id from private.posts p where p.id = p_edit_id and p.owner_id = actor;
  if original_id is null then raise exception 'edit not found' using errcode = '22023'; end if;
  perform 1 from private.posts p where p.id = original_id for update;
  select * into edit from private.posts p where p.id = p_edit_id and p.owner_id = actor and p.edit_of = original_id for update;
  if not found then raise exception 'edit not found' using errcode = '22023'; end if;
  if edit.revision <> p_expected_revision then raise exception 'edit changed' using errcode = 'PT409'; end if;
  delete from private.posts where id = edit.id;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', edit.id, 'edit_of', original_id, 'status', 'discarded');
end;
$function$;
alter function internal.discard_post_edit(uuid,integer) owner to postgres;
revoke all on function internal.discard_post_edit(uuid,integer) from public;
grant execute on function internal.discard_post_edit(uuid,integer) to authenticated;
