-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.intro_trial_waiting(p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.intro_trial_requests r join private.posts p on p.id=r.post_id
    where r.owner_id=p_owner and p.owner_id=p_owner and p.status='pending_moderation'
      and not exists(select 1 from private.post_activations a where a.post_id=p.id and a.released_at is null));
$function$;
alter function internal.intro_trial_waiting(uuid) owner to postgres;
revoke all on function internal.intro_trial_waiting(uuid) from public;
