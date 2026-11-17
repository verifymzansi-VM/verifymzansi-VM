-- An email that was skipped no longer shows as sent in the member's history.
--
-- The email job finishes a queued message without sending it when there is
-- nothing to send: the account has no confirmed address (or is anonymous, or
-- closed for a notice that is not sent to closed accounts), or a payment was
-- refunded or charged back before its "Payment received" email went out. It
-- calls api.complete_notification_outbox with p_ok=true, which cleared
-- delivery_error, so internal.list_my_email_history listed the message as
-- "sent" on the member's communication page.
--
-- From this update (same signatures, grants and owners):
-- 1. internal.complete_notification_outbox keeps the reason of a message
--    finished without sending: with p_ok=true it accepts p_error null (sent)
--    or 'skipped' (nothing sent), and stores it in delivery_error. Any other
--    reason with p_ok=true, and 'skipped' with p_ok=false, is refused with
--    22023 'invalid outcome' (no caller sends either). A failed attempt
--    (p_ok=false) is recorded exactly as before.
-- 2. internal.list_my_email_history leaves out a message whose delivery_error
--    is 'skipped'. The history keeps its two states, "sent" and "failed", so
--    the communication page shows no new label: a skipped email is simply not
--    in the list. The rest of the read is unchanged.
--
-- The website release from the same pull request passes p_error='skipped'
-- when it finishes a message without sending it. Safe in either order:
-- - website first: a database before this update accepts 'skipped' with
--   p_ok=true (the reason matches its ^[a-z_]{1,80}$ rule) and clears it, so
--   the message still shows as sent, as today;
-- - database first: the earlier website passes no reason for a skipped
--   message, so it still shows as sent until that release is deployed; the
--   history keeps the same JSON shape (no new status value), so the earlier
--   website reads it unchanged.
-- Messages skipped before the website release carry no reason and stay listed
-- as sent; they leave the history when retention removes them (30 days).
--
-- ORDER: any time; apply after 20261117082021_switch_posting_terms_v5.sql in
-- filename order. Read-only preflight:
-- ../preflight/20261117123240_skipped_email_status.check.sql.
-- Rollback: ../rollback/20261117123240_skipped_email_status.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Preconditions: both functions have the reviewed earlier body, or already
-- this update's.
do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.complete_notification_outbox(uuid,uuid,boolean,text)'),
      ('internal.list_my_email_history(integer)')) v(sig)
  loop
    if shape not in (
        'internal.complete_notification_outbox(uuid,uuid,boolean,text) a87eff16c79b115b0bb2f385b7e41fa9',
        'internal.complete_notification_outbox(uuid,uuid,boolean,text) d0ac8636fcde58e25ca51bef842ea434',
        'internal.list_my_email_history(integer) bae293aa4451ea71502c27863c1cf5e6',
        'internal.list_my_email_history(integer) af3d191eb50ae6e67a6417269ef39876') then
      raise exception 'skipped email status precondition: % is not a reviewed body', shape
        using errcode='55000';
    end if;
  end loop;
end$$;

CREATE OR REPLACE FUNCTION internal.complete_notification_outbox(p_id uuid, p_claim uuid, p_ok boolean, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare changed integer;
begin
  -- A finished message carries no reason (sent) or 'skipped' (nothing was
  -- sent); a message given back carries its failure reason.
  if p_ok is null or (p_error is not null and p_error !~ '^[a-z_]{1,80}$')
    or (p_ok and p_error is distinct from 'skipped' and p_error is not null)
    or (not p_ok and p_error = 'skipped') then
    raise exception 'invalid outcome' using errcode='22023'; end if;
  update private.outbox_events set processed_at=case when p_ok then statement_timestamp() else null end,
    delivery_claim=null,delivery_until=null,delivery_error=case when p_ok then p_error else coalesce(p_error,'delivery_failed') end,
    delivery_after=statement_timestamp()+make_interval(secs=>least(21600,30*(2^least(delivery_attempts,9))::integer))
  where id=p_id and delivery_claim=p_claim and processed_at is null and delivery_until>statement_timestamp();
  get diagnostics changed=row_count;
  return changed=1;
end;
$function$;
alter function internal.complete_notification_outbox(uuid,uuid,boolean,text) owner to postgres;
revoke all on function internal.complete_notification_outbox(uuid,uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function internal.complete_notification_outbox(uuid,uuid,boolean,text) to service_role;

CREATE OR REPLACE FUNCTION internal.list_my_email_history(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.consent_actor(); items jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid limit' using errcode='22023';
  end if;
  -- A message finished without sending (delivery_error 'skipped') is not an
  -- email the member was sent: it is left out.
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'at', x.at)
      order by x.created_at desc, x.id), '[]'::jsonb)
    into items
  from (select o.id, o.kind, o.created_at,
      case when o.processed_at is not null then 'sent' else 'failed' end as status,
      coalesce(o.processed_at, o.created_at) as at
    from private.outbox_events o
    where o.owner_id = actor and o.delivery_error is distinct from 'skipped'
      and (o.processed_at is not null
      or (o.delivery_attempts >= 8 and o.delivery_error is distinct from 'outcome_unknown'
        and (o.delivery_until is null or o.delivery_until < statement_timestamp())))
    order by o.created_at desc, o.id
    limit p_limit) x;
  return jsonb_build_object('items', items);
end;
$function$;
alter function internal.list_my_email_history(integer) owner to postgres;
revoke all on function internal.list_my_email_history(integer) from public,anon,authenticated,service_role;
grant execute on function internal.list_my_email_history(integer) to authenticated;

notify pgrst,'reload schema';
commit;
