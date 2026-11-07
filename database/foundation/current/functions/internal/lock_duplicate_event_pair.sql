-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_duplicate_event_pair(p_a uuid, p_b uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_a is null or p_b is null or p_a>=p_b then
    raise exception 'choose two different event posts' using errcode='22023';
  end if;
  -- Preserve key-share FK checks while serializing actual content/state/deletion.
  perform p.id from private.posts p where p.id in(p_a,p_b) order by p.id for no key update;
end;
$function$;
alter function internal.lock_duplicate_event_pair(uuid,uuid) owner to postgres;
revoke all on function internal.lock_duplicate_event_pair(uuid,uuid) from public;
