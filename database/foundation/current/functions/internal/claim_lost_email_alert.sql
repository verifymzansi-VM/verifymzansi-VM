-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_lost_email_alert(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  now_at timestamptz := clock_timestamp();
  batch private.lost_email_alerts;
  batch_id uuid;
  lost_total integer;
  lost_payments integer;
  listed jsonb;
  nothing constant jsonb := jsonb_build_object('claim',null,'total',0,'items','[]'::jsonb);
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid lost email alert limit' using errcode='22023'; end if;
  -- One email job at a time takes or makes an alert.
  perform pg_advisory_xact_lock(hashtextextended('private.lost_email_alerts',0));
  -- Sent alerts are kept 400 days after sending, also while nothing is lost.
  delete from private.lost_email_alerts where sent_at<now_at-interval '400 days';
  -- An alert whose send failed (its lease ended or was given back) is offered
  -- again first, unchanged: same id, same list.
  update private.lost_email_alerts a set claimed_until=now_at+interval '5 minutes'
    where a.id=(select x.id from private.lost_email_alerts x where x.sent_at is null and x.claimed_until<=now_at
      order by x.created_at,x.id limit 1)
    returning a.* into batch;
  if found then
    return jsonb_build_object('claim',batch.id,'total',batch.total,'payments',batch.payments,'items',batch.items);
  end if;
  -- An alert still being sent, or one sent in the last 15 minutes: wait, so
  -- many losses at once give one email.
  if exists(select 1 from private.lost_email_alerts x
      where x.sent_at is null or x.sent_at>now_at-interval '15 minutes') then
    return nothing;
  end if;
  -- Every lost row not yet reported: unsent after its last attempt, with its
  -- lease ended.
  batch_id := pg_catalog.gen_random_uuid();
  with outbox as (
    update private.outbox_events o set lost_alert_id=batch_id
      where o.processed_at is null and o.delivery_attempts>=8 and o.lost_alert_id is null
        and (o.delivery_until is null or o.delivery_until<now_at)
      returning o.id,o.created_at,jsonb_build_object('source','outbox','id',o.id,'kind',o.kind,
        'attempts',o.delivery_attempts,'queued_at',o.created_at,'last_error',o.delivery_error) as item),
  notices as (
    update private.privacy_notice_jobs j set lost_alert_id=batch_id
      where j.delivered_at is null and j.attempts>=8 and j.lost_alert_id is null
        and (j.locked_until is null or j.locked_until<now_at)
      returning j.id,j.created_at,jsonb_build_object('source','privacy_notice','id',j.id,
        'kind','privacy_notice_'||j.kind,'attempts',j.attempts,'queued_at',j.created_at,'last_error',null) as item),
  lost as (select * from outbox union all select * from notices)
  select (select count(*) from lost),
    -- The payment emails among all of them, listed or not.
    (select count(*) from lost l where starts_with(l.item->>'kind','payment_')),
    coalesce((select jsonb_agg(l.item order by l.created_at,l.id)
      from (select * from lost order by created_at,id limit p_limit) l),'[]'::jsonb)
    into lost_total, lost_payments, listed;
  if lost_total=0 then return nothing; end if;
  insert into private.lost_email_alerts(id,created_at,claimed_until,items,total,payments)
    values(batch_id,now_at,now_at+interval '5 minutes',listed,lost_total,lost_payments);
  return jsonb_build_object('claim',batch_id,'total',lost_total,'payments',lost_payments,'items',listed);
end;
$function$;
alter function internal.claim_lost_email_alert(integer) owner to postgres;
revoke all on function internal.claim_lost_email_alert(integer) from public;
grant execute on function internal.claim_lost_email_alert(integer) to service_role;
