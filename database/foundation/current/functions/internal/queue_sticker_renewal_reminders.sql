-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.queue_sticker_renewal_reminders(p_limit integer)
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
    select 'sticker_renewal_reminder', d.id, d.owner_id, d.dedupe_key from (
      select c.id, c.owner_id, c.expires_at, internal.sticker_renewal_reminder_key(c.id, c.owner_id) as dedupe_key
      from private.frontend_business_checks c
      where c.status='approved' and c.kind in('cipc','seen')
        and c.expires_at>statement_timestamp() and c.expires_at<=statement_timestamp()+interval '30 days'
    ) d
    where d.dedupe_key is not null
      and not exists(select 1 from private.outbox_events o where o.dedupe_key=d.dedupe_key)
    order by d.expires_at, d.id limit p_limit
    on conflict (dedupe_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$function$;
alter function internal.queue_sticker_renewal_reminders(integer) owner to postgres;
revoke all on function internal.queue_sticker_renewal_reminders(integer) from public;
grant execute on function internal.queue_sticker_renewal_reminders(integer) to service_role;
