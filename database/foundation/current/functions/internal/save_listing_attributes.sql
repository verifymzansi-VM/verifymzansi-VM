-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_listing_attributes(p_post_id uuid, p_expected_revision integer, p_attributes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); post private.posts; normalized jsonb;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  select p.* into post from private.posts p where p.id=p_post_id and p.owner_id=actor and p.kind='listing' for update;
  if not found or post.status not in ('draft','rejected','paused') then raise exception 'editable listing unavailable' using errcode='22023'; end if;
  if post.revision is distinct from p_expected_revision then raise exception 'listing changed' using errcode='PT409'; end if;
  normalized:=internal.validate_listing_attributes(post.category_key,p_attributes,false);
  update private.listing_details set attributes=normalized,attributes_version=1 where post_id=post.id;
  update private.posts set revision=revision+1,content_updated_at=statement_timestamp() where id=post.id;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id',post.id,'revision',post.revision+1,'attributes_version',1,'attributes',normalized);
end;
$function$;
alter function internal.save_listing_attributes(uuid,integer,jsonb) owner to postgres;
revoke all on function internal.save_listing_attributes(uuid,integer,jsonb) from public;
grant execute on function internal.save_listing_attributes(uuid,integer,jsonb) to authenticated;
