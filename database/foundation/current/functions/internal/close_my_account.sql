-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.close_my_account()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.account_closing_actor(); er private.account_erasures; rule private.privacy_request_rules;
  r private.privacy_requests; address text; now_at timestamptz;
begin
  perform internal.lock_evidence_subject(actor);
  actor := internal.account_closing_actor(); -- the session is still live after the wait
  select u.email into address from auth.users u where u.id = actor;
  if address is null or length(address) not between 3 and 254 then
    raise exception 'live confirmed member session required' using errcode = '42501';
  end if;
  er := internal.close_account_now(actor, 'member', actor);
  select * into rule from private.privacy_request_rules where request_type = 'deletion';
  now_at := clock_timestamp();
  insert into private.privacy_requests (type, subject_user_id, requester_email, description, identity_check,
    received_at, due_by, legal_basis)
  values ('deletion', actor, address,
    'Closed the account from the account page after signing in again. Erase it after the 30-day grace period.',
    'session', now_at, er.erase_after + interval '7 days', rule.source)
  returning * into r;
  insert into private.privacy_request_events (request_id, actor_id, action, represented_revision)
    values (r.id, actor, 'submitted', 1);
  insert into private.privacy_notice_jobs (request_id, kind) values (r.id, 'submitted');
  insert into private.account_erasure_requests (request_id, user_id, linked_how) values (r.id, actor, 'member_closed');
  return jsonb_build_object('status', 'closed', 'closed_at', er.closed_at, 'erase_after', er.erase_after,
    'request_id', r.id);
end;
$function$;
alter function internal.close_my_account() owner to postgres;
revoke all on function internal.close_my_account() from public;
grant execute on function internal.close_my_account() to authenticated;
