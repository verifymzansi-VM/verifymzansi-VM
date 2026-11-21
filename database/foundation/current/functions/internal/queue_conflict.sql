-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.queue_conflict(p_actor uuid, p_post_id uuid, p_report_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p_post_id is not null
    -- Staff review posts only with an accepted ID review of their own.
    then internal.current_verified_identity(p_actor) is null
      or (exists(select 1 from private.posts p where p.id=p_post_id and p.owner_id=p_actor)
        -- Single-administrator mode: the only ID-verified staff member may
        -- review their own post when one of their current house slots funds
        -- it (for an edit, the live post it edits).
        and not (exists(select 1 from private.posts p
            join private.post_activations a on a.post_id=coalesce(p.edit_of, p.id) and a.released_at is null
            join private.entitlements e on e.id=a.entitlement_id
            where p.id=p_post_id and e.owner_id=p_actor and e.source='staff_grant'
              and e.status='active' and e.ends_at>statement_timestamp()
              and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id))
          and internal.single_administrator(p_actor)))
    else exists(select 1 from private.reports r where r.id=p_report_id and
      (r.reporter_id=p_actor or r.subject_account_id=p_actor
       or r.duplicate_owner_b=p_actor or r.duplicate_created_by=p_actor))
  end;
$function$;
alter function internal.queue_conflict(uuid,uuid,uuid) owner to postgres;
revoke all on function internal.queue_conflict(uuid,uuid,uuid) from public;
