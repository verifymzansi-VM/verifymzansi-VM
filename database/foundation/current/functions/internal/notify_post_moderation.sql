-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.notify_post_moderation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare owner uuid;
begin
  -- post_id is the live post (for an edit, the post the edit changes).
  select p.owner_id into owner from private.posts p where p.id=new.post_id;
  if owner is null or not exists(select 1 from auth.users u where u.id=owner) then return null; end if;
  perform internal.notify_account(owner,
    case when new.edit_id is null then case when new.decision='approve' then 'post_approved' else 'post_rejected' end
      else case when new.decision='approve' then 'post_changes_approved' else 'post_changes_rejected' end end,
    coalesce(new.edit_id,new.post_id),new.post_id,null);
  return null;
end;
$function$;
alter function internal.notify_post_moderation() owner to postgres;
revoke all on function internal.notify_post_moderation() from public;
