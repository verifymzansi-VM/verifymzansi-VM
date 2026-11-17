-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.queue_conflict(p_actor uuid, p_post_id uuid, p_report_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p_post_id is not null
    then exists(select 1 from private.posts p where p.id=p_post_id and p.owner_id=p_actor)
    else exists(select 1 from private.reports r where r.id=p_report_id and
      (r.reporter_id=p_actor or r.subject_account_id=p_actor
       or r.duplicate_owner_b=p_actor or r.duplicate_created_by=p_actor))
  end;
$function$;
alter function internal.queue_conflict(uuid,uuid,uuid) owner to postgres;
revoke all on function internal.queue_conflict(uuid,uuid,uuid) from public;
