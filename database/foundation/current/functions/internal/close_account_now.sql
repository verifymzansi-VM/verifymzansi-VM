-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.close_account_now(p_user uuid, p_by text, p_actor uuid)
 RETURNS private.account_erasures
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare er private.account_erasures; closed timestamptz;
begin
  if p_user is null or p_actor is null or p_by is null or p_by not in ('member', 'staff') then
    raise exception 'account and closing party required' using errcode = '22023';
  end if;
  perform internal.lock_evidence_subject(p_user);
  select * into er from private.account_erasures e where e.user_id = p_user for update;
  if found then return er; end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'account not found' using errcode = 'PT404', detail = 'account_unavailable';
  end if;
  closed := (internal.close_account_evidence(p_user)->>'closed_at')::timestamptz;
  insert into private.account_erasures (user_id, closed_at, erase_after, closed_by, paid_until)
  values (p_user, closed, closed + interval '30 days', p_by,
    (select max(e.ends_at) from private.entitlements e where e.owner_id = p_user and e.source = 'retail_paid'
      and e.status = 'active' and e.ends_at > statement_timestamp()))
  returning * into er;
  update auth.users u set banned_until = statement_timestamp() + interval '100 years' where u.id = p_user;
  if not found then raise exception 'sign-in could not be blocked' using errcode = '55000'; end if;
  perform internal.end_account_sessions(p_user);
  if exists (select 1 from auth.sessions s where s.user_id = p_user) then
    raise exception 'sessions could not be ended' using errcode = '55000';
  end if;
  -- A partner account earns nothing more; its commission records stay.
  with suspended as (
    update private.partners x set status = 'suspended', revision = least(x.revision + 1, 2147483647),
        updated_at = statement_timestamp()
      where x.account_id = p_user and x.status <> 'suspended'
    returning x.id
  )
  insert into private.partner_events (partner_id, actor_id, action, reason)
    select suspended.id, p_actor, 'suspended_account_closed', 'The partner account was closed.' from suspended;
  return er;
end;
$function$;
alter function internal.close_account_now(uuid,text,uuid) owner to postgres;
revoke all on function internal.close_account_now(uuid,text,uuid) from public;
