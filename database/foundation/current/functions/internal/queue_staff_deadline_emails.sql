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
begin
  if needed is null then raise exception 'unknown staff email kind' using errcode='22023'; end if;
  -- A staff duplicate-event report: the staff member raised it.
  if email_kind='staff_report' and item->>'report_origin' is distinct from 'public' then return null; end if;
  -- Whoever submitted it already knows: the member, the staff member who
  -- recorded a request received another way, the appellant, the reporter.
  submitters := array_remove(array[(item->>'subject_user_id')::uuid,(item->>'intake_by')::uuid,
    (item->>'appellant_id')::uuid,(item->>'reporter_id')::uuid],null);
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
  select email_kind,new.id,r.user_id,email_kind||':'||new.id::text||':'||r.user_id::text
  from private.staff_roles r
  join private.staff_capabilities c on c.role=r.role and c.capability=needed
  join auth.users u on u.id=r.user_id
  where r.revoked_at is null and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
    and not (r.user_id=any(submitters))
    -- At most 20 report emails a staff member an hour.
    and (email_kind<>'staff_report' or (select count(*) from private.outbox_events o where o.owner_id=r.user_id
      and o.kind='staff_report' and o.created_at>statement_timestamp()-interval '1 hour')<20)
  on conflict (dedupe_key) do nothing;
  return null;
end;
$function$;
alter function internal.queue_staff_deadline_emails() owner to postgres;
revoke all on function internal.queue_staff_deadline_emails() from public;
