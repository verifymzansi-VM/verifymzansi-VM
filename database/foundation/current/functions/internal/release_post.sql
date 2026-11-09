-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.release_post(p_post_id uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); post private.posts; released boolean;
begin
  if p_reason is null or p_reason not in ('owner', 'sold') then raise exception 'invalid release reason' using errcode = '22023'; end if;
  select p.* into post from private.posts p where p.id=p_post_id and p.owner_id=actor for update;
  if not found or post.status in ('live','pending_moderation') then
    raise exception 'use the revision-fenced post lifecycle to release published funding' using errcode='22023';
  end if;
  update private.post_activations a set released_at = statement_timestamp(), release_reason = p_reason
  where a.post_id = p_post_id and a.owner_id = actor and a.released_at is null;
  released:=found;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return released;
end;
$function$;
alter function internal.release_post(uuid,text) owner to postgres;
revoke all on function internal.release_post(uuid,text) from public;
grant execute on function internal.release_post(uuid,text) to authenticated;
