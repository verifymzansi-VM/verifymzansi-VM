-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.queue_free_credit_reminders(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare queued integer;
begin
  if p_limit is null or p_limit < 1 then
    return 0;
  end if;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
    select 'free_credit_reminder', d.id, d.owner_id, d.dedupe_key from (
      select g.id, g.owner_id, g.ends_at, internal.free_credit_reminder_key(g.id, g.owner_id) as dedupe_key
      from private.entitlements g
      where g.status='active' and g.source='free_credit'
        and g.ends_at>statement_timestamp() and g.ends_at<=statement_timestamp()+interval '3 days'
    ) d
    where d.dedupe_key is not null
      and not exists(select 1 from private.outbox_events o where o.dedupe_key=d.dedupe_key)
    order by d.ends_at, d.id limit p_limit
    on conflict (dedupe_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$function$;
alter function internal.queue_free_credit_reminders(integer) owner to postgres;
revoke all on function internal.queue_free_credit_reminders(integer) from public;
grant execute on function internal.queue_free_credit_reminders(integer) to service_role;
