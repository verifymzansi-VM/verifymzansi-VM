-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_ozow_refund_sends_due(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_limit is null or p_limit not between 1 and 20 then
    raise exception 'invalid refund send limit' using errcode='22023';
  end if;
  return coalesce((select jsonb_agg(d.id order by d.due_at, d.id) from (
      select r.id, coalesce(r.last_send_at, r.approved_at) as due_at from private.payment_refund_requests r
      where r.channel = 'api' and ((r.status = 'approved' and r.approved_at <= statement_timestamp() - interval '2 minutes')
        or (r.status = 'sent' and r.send_outcome = 'unknown' and r.ozow_refund_id is null and r.send_attempts < 3
          and r.last_send_at <= statement_timestamp() - interval '5 minutes'
          and r.sent_at > statement_timestamp() - interval '6 hours'))
      order by 2, 1 limit p_limit) d), '[]'::jsonb);
end;
$function$;
alter function internal.list_ozow_refund_sends_due(integer) owner to postgres;
revoke all on function internal.list_ozow_refund_sends_due(integer) from public;
grant execute on function internal.list_ozow_refund_sends_due(integer) to service_role;
