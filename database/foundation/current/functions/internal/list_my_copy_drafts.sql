-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_my_copy_drafts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id,
      'deletes_at', p.content_updated_at + interval '14 days') order by p.content_updated_at desc, p.id), '[]'::jsonb)
    into items
  from private.post_copies c join private.posts p on p.id = c.post_id
  where p.owner_id = actor and p.status = 'draft' and p.edit_of is null;
  return jsonb_build_object('items', items);
end;
$function$;
alter function internal.list_my_copy_drafts() owner to postgres;
revoke all on function internal.list_my_copy_drafts() from public;
grant execute on function internal.list_my_copy_drafts() to authenticated;
