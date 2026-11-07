-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.set_post_contacts(p_post_id uuid, p_expected_revision integer, p_channels jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); post private.posts; chosen text[]; rev integer;
begin
  perform internal.assert_post_revision(p_expected_revision);
  chosen:=internal.canonical_post_channels(p_channels);
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  select * into post from private.posts p where p.id=p_post_id and p.owner_id=actor for update;
  perform internal.price_draft_actor();
  if post.id is null or post.kind not in ('listing','event') then
    raise exception 'post unavailable' using errcode='22023';
  end if;
  if post.status not in ('draft','rejected','paused') then
    raise exception 'only drafts can be edited' using errcode='22023';
  end if;
  if post.revision<>p_expected_revision then raise exception 'post changed' using errcode='PT409'; end if;
  insert into private.post_contacts(post_id,post_kind,channels) values(post.id,post.kind,chosen)
    on conflict(post_id) do update set channels=excluded.channels;
  update private.posts set revision=revision+1,content_updated_at=statement_timestamp()
    where id=post.id returning revision into rev;
  perform internal.price_draft_actor();
  return jsonb_build_object('id',post.id,'revision',rev,'channels',to_jsonb(chosen));
end;
$function$;
alter function internal.set_post_contacts(uuid,integer,jsonb) owner to postgres;
revoke all on function internal.set_post_contacts(uuid,integer,jsonb) from public;
grant execute on function internal.set_post_contacts(uuid,integer,jsonb) to authenticated;
