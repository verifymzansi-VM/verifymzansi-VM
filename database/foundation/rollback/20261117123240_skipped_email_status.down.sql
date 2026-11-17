-- Reviewed rollback for updates/20261117123240_skipped_email_status.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It puts back the earlier bodies of internal.complete_notification_outbox and
-- internal.list_my_email_history byte for byte (same signatures, grants and
-- owners). The website keeps working: the earlier body accepts 'skipped' with
-- p_ok=true and clears it. Messages already stored with delivery_error
-- 'skipped' keep it (the earlier history then lists them as sent, as it did
-- before the update; applying the update again hides them again). It refuses
-- (55000) unless both functions have this update's bodies (a later update
-- changed one: undo that update first).
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.complete_notification_outbox(uuid,uuid,boolean,text)'),
      ('internal.list_my_email_history(integer)')) v(sig)
  loop
    if shape not in (
        'internal.complete_notification_outbox(uuid,uuid,boolean,text) d0ac8636fcde58e25ca51bef842ea434',
        'internal.list_my_email_history(integer) af3d191eb50ae6e67a6417269ef39876') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
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
  if p_ok is null or (p_error is not null and p_error !~ '^[a-z_]{1,80}$') then
    raise exception 'invalid outcome' using errcode='22023'; end if;
  update private.outbox_events set processed_at=case when p_ok then statement_timestamp() else null end,
    delivery_claim=null,delivery_until=null,delivery_error=case when p_ok then null else coalesce(p_error,'delivery_failed') end,
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
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'at', x.at)
      order by x.created_at desc, x.id), '[]'::jsonb)
    into items
  from (select o.id, o.kind, o.created_at,
      case when o.processed_at is not null then 'sent' else 'failed' end as status,
      coalesce(o.processed_at, o.created_at) as at
    from private.outbox_events o
    where o.owner_id = actor and (o.processed_at is not null
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
