-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.queue_staff_deadline_emails()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  item jsonb := to_jsonb(new);
  email_kind text := tg_argv[0];
  needed text := internal.staff_email_capability(tg_argv[0]);
  submitters uuid[];
  room bigint;
begin
  if needed is null then raise exception 'unknown staff email kind' using errcode='22023'; end if;
  -- A staff duplicate-event report: the staff member raised it.
  if email_kind='staff_report' and item->>'report_origin' is distinct from 'public' then return null; end if;
  -- Whoever submitted it already knows: the member, the staff member who
  -- recorded a request received another way, the appellant, the reporter.
  -- The person a report is about is never told of it.
  submitters := array_remove(array[(item->>'subject_user_id')::uuid,(item->>'intake_by')::uuid,
    (item->>'appellant_id')::uuid,(item->>'reporter_id')::uuid,(item->>'subject_account_id')::uuid],null);
  -- Whoever took, approved or reported the decision appealed against may not
  -- decide the appeal.
  if email_kind='staff_appeal' then
    submitters := submitters||coalesce((select array_agg(b) from private.frontend_appealable_actions d
      cross join lateral unnest(array[d.actor_id,d.approver_id,d.reporter_id]) b
      where d.id=(item->>'action_id')::uuid and d.account_id=(item->>'appellant_id')::uuid and b is not null),
      '{}'::uuid[]);
  end if;
  -- A privacy request has a legal deadline, so it is outside the cap below:
  -- each member's first request in any 24 hours is emailed; later ones (a
  -- member may file 5 an hour) are only in the staff queue. A member's
  -- requests queue one at a time. One recorded by staff for someone without
  -- an account is always emailed.
  if email_kind='staff_privacy_request' then
    if item->>'subject_user_id' is not null then
      perform pg_advisory_xact_lock(hashtextextended('private.staff_deadline_emails:'||(item->>'subject_user_id'),0));
      if exists(select 1 from private.outbox_events o join private.privacy_requests p on p.id=o.subject_id
          where o.kind='staff_privacy_request' and o.created_at>statement_timestamp()-interval '24 hours'
            and p.subject_user_id=(item->>'subject_user_id')::uuid and p.id<>new.id) then
        return null;
      end if;
    end if;
  -- Appeals and reports: at most 30 in any 24 hours together, so the email
  -- provider's daily allowance keeps room for members' emails; items past it
  -- are still in the staff queues. Submissions queue one at a time, so
  -- overlapping ones cannot pass the cap; that holds only at read committed
  -- (each statement sees what committed before it), so at a stricter level
  -- none is queued.
  else
    if current_setting('transaction_isolation') in('repeatable read','serializable') then return null; end if;
    perform pg_advisory_xact_lock(hashtextextended('private.staff_deadline_emails',0));
    room := 30-(select count(*) from private.outbox_events o
      where o.kind in('staff_appeal','staff_report')
        and o.created_at>statement_timestamp()-interval '24 hours');
    if room<=0 then return null; end if;
  end if;
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
  select email_kind,new.id,r.user_id,email_kind||':'||new.id::text||':'||r.user_id::text
  from private.staff_roles r
  join private.staff_capabilities c on c.role=r.role and c.capability=needed
  join auth.users u on u.id=r.user_id
  where r.revoked_at is null and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
    and not (r.user_id=any(submitters))
    -- Every staff page needs one (internal.staff_actor).
    and exists(select 1 from auth.mfa_factors f where f.user_id=r.user_id and f.factor_type='totp' and f.status='verified')
  order by r.granted_at,r.user_id
  limit room
  on conflict (dedupe_key) do nothing;
  return null;
end;
$function$;
alter function internal.queue_staff_deadline_emails() owner to postgres;
revoke all on function internal.queue_staff_deadline_emails() from public;
