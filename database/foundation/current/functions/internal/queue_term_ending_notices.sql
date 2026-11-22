-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.queue_term_ending_notices(p_limit integer)
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
  with due as (
    select g.id, g.owner_id from private.entitlements g
    where g.status='active' and g.source='retail_paid'
      and g.ends_at>statement_timestamp()+interval '63 days'
      and g.ends_at<=statement_timestamp()+interval '84 days'
      and internal.term_ending_notice_due(g.id, g.owner_id)
      and not exists(select 1 from private.outbox_events o where o.dedupe_key='term_ending_notice:'||g.id)
    order by g.ends_at, g.id limit p_limit
  )
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
    select 'term_ending_notice', d.id, d.owner_id, 'term_ending_notice:'||d.id from due d
    on conflict (dedupe_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$function$;
alter function internal.queue_term_ending_notices(integer) owner to postgres;
revoke all on function internal.queue_term_ending_notices(integer) from public;
grant execute on function internal.queue_term_ending_notices(integer) to service_role;
