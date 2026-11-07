-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.cost_usage()
 RETURNS TABLE(metric text, used numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select 'object_storage_bytes',
    (select coalesce(sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes)), 0)
       from private.media_objects m where m.state <> 'deleted')
    -- three resized display copies per photo, about 0.5 MB together
    + (select count(*) * 524288 from private.media_objects m where m.state = 'ready' and m.kind = 'image')
    + (select coalesce(sum(a.size_bytes), 0) from private.evidence_artifacts a where a.state <> 'deleted')
  union all
  select 'object_writes_month',
    (select count(*) * 4 from private.media_objects m where m.kind = 'image'
       and m.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')
    + (select count(*) from private.media_objects m where m.kind = 'video'
       and m.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')
    + (select count(*) from private.evidence_artifacts a
       where a.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')
  union all
  select 'database_bytes', pg_catalog.pg_database_size(pg_catalog.current_database())::numeric
  union all
  select 'monthly_active_users', (select count(*) from auth.users u
    where u.last_sign_in_at > statement_timestamp() - interval '30 days')::numeric
  union all
  select 'notifications_month', (select count(*) from private.outbox_events o
    where o.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')::numeric
  union all
  select 'payments_month', (select count(*) from private.payments p where p.completed_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')::numeric;
$function$;
alter function internal.cost_usage() owner to postgres;
revoke all on function internal.cost_usage() from public;
