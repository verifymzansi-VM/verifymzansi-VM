-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_public_contact_channels(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p.kind='business' then '["form"]'::jsonb else coalesce(to_jsonb(c.channels),'[]'::jsonb) end
  from private.public_eligible_posts eligible join private.posts p on p.id=eligible.id
  left join private.post_contacts c on c.post_id=p.id where p.id=p_post_id;
$function$;
alter function internal.get_public_contact_channels(uuid) owner to postgres;
revoke all on function internal.get_public_contact_channels(uuid) from public;
grant execute on function internal.get_public_contact_channels(uuid) to anon;
grant execute on function internal.get_public_contact_channels(uuid) to authenticated;
