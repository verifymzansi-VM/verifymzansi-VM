-- A written notice before a long paid term ends (launch checklist item 68b).
--
-- The Consumer Protection Act, s14(2)(c), asks a supplier to tell the consumer
-- in writing, 40 to 80 business days before a fixed-term agreement ends, that
-- it is ending and what happens next. The owner's rule: every paid term of 180
-- days or more gets one written notice about 60 business days before it ends;
-- nothing ever renews automatically. Today the only reminder is the renewal
-- reminder (slot_renewal_reminder, 3 days before an Individual slot ends).
--
-- A qualifying term is one paid grant (private.entitlements, source
-- 'retail_paid', so never a free trial, sponsorship, staff grant or house
-- slot) that runs 180 days or more from its own start to its own end: an
-- Individual slot of 180 days, a renewal of one (its own new term), a
-- Multi-listing package of 180 days (its opening grant; slots added part-way
-- end with the package, run less than 180 days and get no notice of their
-- own), and any earlier 180-day plan still running. The grant must still be
-- active, its payment complete and its payment line not refunded or charged
-- back, no renewal may already follow it, and the account must not be closed
-- (internal.term_ending_notice_due).
--
-- From this update, in one transaction:
-- 1. New outbox kind term_ending_notice (the kind check gains it).
-- 2. internal.queue_term_ending_notices(p_limit) queues one email per
--    qualifying term whose end is 63 to 84 calendar days away (84 days is 12
--    weeks, 60 weekdays, so about 60 business days; 63 days still leaves at
--    least 40 business days after public holidays). The email is keyed by the
--    grant (dedupe key term_ending_notice:<grant id>), so at most one per
--    term whatever the retries. The window also keeps it to one after the
--    retention job removes a sent email 30 days after sending: by then the
--    end is under 63 days away. A term that was already under 63 days from
--    its end when this update is applied gets no notice (none can be bought
--    that short). Nothing is charged or renewed.
-- 3. api.run_slot_renewals (full body; the minute job the website already
--    runs) also runs that step and adds its count to its result as
--    term_ending_notices. internal.run_slot_renewals is unchanged.
-- 4. internal.claim_supported_notification_outbox (full body) accepts the new
--    kind (22 kinds, each once), hands it out only to a confirmed,
--    non-anonymous address and only while the term still qualifies
--    (otherwise it is finished as skipped without a send), with the term's
--    end (term_ends_at) and what it is (term_kind: 'individual' for an
--    Individual slot, 'package' for a Multi-listing package, 'other'). The
--    notice is a service notice about the member's own paid term; the
--    optional marketing choices do not apply. No in-app notice is added.
--
-- The website release from the same pull request claims and words the new
-- kind. Safe in either order: an earlier website never claims it (the queued
-- emails wait); a website release before this update finds the kind refused
-- and drops it until the update is applied (src/lib/foundation/
-- operation-jobs.ts, laterKinds). ORDER: apply first, then merge.
-- It refuses with 55000 unless each function it replaces has its reviewed
-- body (or this update's), the new functions are absent (or this update's)
-- and the kind check is the reviewed one (or this update's).
-- Read-only preflight: ../preflight/20261122111209_term_ending_notice.check.sql.
-- Rollback: ../rollback/20261122111209_term_ending_notice.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare shape text; kind_check text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.claim_supported_notification_outbox(text[],integer)'),
      ('api.run_slot_renewals(integer)'),('internal.term_ending_notice_due(uuid,uuid)'),
      ('internal.queue_term_ending_notices(integer)')) v(sig)
  loop
    if shape not in (
        'internal.claim_supported_notification_outbox(text[],integer) c7206aab3ac04b1f9d9b6ce2dc47bd0f',
        'internal.claim_supported_notification_outbox(text[],integer) d7bce6d6994095f93fb3ca5dac54e3e6',
        'api.run_slot_renewals(integer) b78dc0ac9c98fd46da971c17a3f07a43',
        'api.run_slot_renewals(integer) 64c3c57229ca6fe6b8163fd8d57dbfcc',
        'internal.term_ending_notice_due(uuid,uuid) absent',
        'internal.term_ending_notice_due(uuid,uuid) db5cfe64a62f97b249b9348d34599ce8',
        'internal.queue_term_ending_notices(integer) absent',
        'internal.queue_term_ending_notices(integer) 70a197a68c46e8cb4a1fbc53056e0d86') then
      raise exception 'term ending notice precondition: % is not a reviewed body', shape
        using errcode='55000';
    end if;
  end loop;
  select md5(pg_get_constraintdef(c.oid)) into kind_check from pg_constraint c
    where c.conrelid='private.outbox_events'::regclass and c.conname='outbox_events_kind_check';
  if kind_check is null or kind_check not in ('2680543d010bccf4d2035c154f680430','3680e8be14065608e4f18ffd2a041fd3') then
    raise exception 'term ending notice precondition: the outbox kind check is not the reviewed one (md5 %)',
      coalesce(kind_check,'missing') using errcode='55000';
  end if;
end$$;

-- 1. The notice's outbox kind.
alter table private.outbox_events drop constraint if exists outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check (kind = any (array['payment_completed',
  'payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
  'draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received',
  'account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update',
  'post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice']));

-- 2. Whether a grant is a paid term of 180 days or more that still ends as
-- bought: active, paid, not refunded or charged back, not yet followed by a
-- renewal, of an account that is not closed.
CREATE OR REPLACE FUNCTION internal.term_ending_notice_due(p_entitlement uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.entitlements g
      join private.payments pay on pay.id=g.payment_id
    where g.id=p_entitlement and g.owner_id=p_owner and g.source='retail_paid' and g.status='active'
      and g.ends_at-g.starts_at>=interval '180 days' and g.ends_at>clock_timestamp()
      and pay.status='complete' and pay.owner_id=g.owner_id
      and (g.payment_line_id is null or exists(select 1 from private.payment_lines l
        where l.id=g.payment_line_id and l.payment_id=g.payment_id and l.status='open'))
      and not exists(select 1 from private.entitlements n where n.slot_id=coalesce(g.slot_id,g.id)
        and n.id<>g.id and n.status='active' and n.starts_at<=g.ends_at and n.ends_at>g.ends_at)
      and not exists(select 1 from private.account_closures c where c.user_id=g.owner_id));
$function$;
alter function internal.term_ending_notice_due(uuid,uuid) owner to postgres;
revoke all on function internal.term_ending_notice_due(uuid,uuid) from public,anon,authenticated,service_role;

-- Queues one notice per qualifying term whose end is 63 to 84 days away.
-- Called by api.run_slot_renewals, after the same p_limit is checked there
-- (1 to 5000); read by date (entitlements_active_ends_idx).
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
revoke all on function internal.queue_term_ending_notices(integer) from public,anon,authenticated,service_role;
grant execute on function internal.queue_term_ending_notices(integer) to service_role;

-- 3. The minute job also queues the notices.
CREATE OR REPLACE FUNCTION api.run_slot_renewals(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('slot_renewals', internal.run_slot_renewals(p_limit)
    || jsonb_build_object('term_ending_notices', internal.queue_term_ending_notices(p_limit)));
$function$;
alter function api.run_slot_renewals(integer) owner to postgres;
revoke all on function api.run_slot_renewals(integer) from public;
grant execute on function api.run_slot_renewals(integer) to service_role;

-- 4. The email job claims the notice.
CREATE OR REPLACE FUNCTION internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  -- Each kind once; 22 kinds since the term-ending notice.
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 22 or coalesce(array_ndims(p_supported_kinds),0)<>1
    or (select count(distinct coalesce(k,'')) from unnest(p_supported_kinds) k)<>cardinality(p_supported_kinds) then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid limit' using errcode='22023'; end if;
  with due as (select id from private.outbox_events where kind=any(p_supported_kinds) and processed_at is null
    and delivery_attempts<8 and delivery_after<=statement_timestamp()
    and (delivery_until is null or delivery_until<statement_timestamp())
    order by created_at,id for update skip locked limit p_limit), claimed as (
    update private.outbox_events o set delivery_attempts=o.delivery_attempts+1,
      delivery_claim=pg_catalog.gen_random_uuid(),delivery_until=statement_timestamp()+interval '90 seconds'
    from due where o.id=due.id returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'kind',o.kind,'subject_id',o.subject_id,
    'owner_id',o.owner_id,'claim_token',o.delivery_claim,'locked_until',o.delivery_until,
    'attempts',o.delivery_attempts,'recipient',case when u.email_confirmed_at is not null and not u.is_anonymous and (o.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned') or not exists(select 1 from private.account_closures c where c.user_id=u.id))
      and (o.kind<>'slot_renewal_reminder' or internal.slot_renewal_due(o.subject_id,o.owner_id))
      and (o.kind<>'term_ending_notice' or internal.term_ending_notice_due(o.subject_id,o.owner_id)) then u.email end,
    'post_title',p.title,'post_id',p.id,'created_at',o.created_at,'notice_reason',case when o.kind='account_warning' then (select r.reason from private.frontend_report_action_receipts r join private.frontend_account_warnings w on w.receipt_id=r.id where r.id=o.subject_id and w.account_id=o.owner_id) end,
    'deletes_at',p.deletes_at,
    'holds_slot',case when p.id is not null then exists(select 1 from private.post_activations a where a.post_id=p.id and a.released_at is null) end,
    'trial_ends_at',tr.ends_at,
    'trial_funds_post',case when tr.id is not null then exists(select 1 from private.post_activations a
      join private.posts fp on fp.id=a.post_id where a.entitlement_id=tr.id and a.released_at is null and fp.status='live') end,
    -- The renewal reminder: when the slot ends, and whether more than one of
    -- the member's slots ends unrenewed within 7 days ("Renew all").
    'slot_ends_at',sg.ends_at,
    'renewal_kind',case when sg.id is not null then 'individual' end,
    'slot_renew_all',case when sg.id is not null then (select count(*)>1 from private.entitlements x
      where x.owner_id=o.owner_id and x.status='active' and x.ends_at<=statement_timestamp()+interval '7 days'
        and internal.slot_renewal_due(x.id,o.owner_id)) end,
    -- The term-ending notice: when the term ends, and what it is.
    'term_ends_at',tg.ends_at,
    'term_kind',case when tg.id is null then null when tg.package_id is not null then 'package'
      when exists(select 1 from private.payment_lines l join private.plan_versions v on v.id=l.plan_version_id
        where l.id=tg.payment_line_id and internal.individual_slot_plan(v.plan_code)) then 'individual'
      else 'other' end) order by o.created_at,o.id),'[]'::jsonb)
    into result from claimed o left join auth.users u on u.id=o.owner_id
    left join private.enquiries e on o.kind='enquiry_received' and e.id=o.subject_id
    left join private.posts p on p.id=case when o.kind='enquiry_received' then e.post_id else o.subject_id end
    left join private.entitlements tr on o.kind='trial_started' and tr.id=o.subject_id and tr.source='intro_trial'
      and tr.owner_id=o.owner_id and tr.status='active'
    left join private.entitlements sg on o.kind='slot_renewal_reminder' and sg.id=o.subject_id and sg.owner_id=o.owner_id
    left join private.entitlements tg on o.kind='term_ending_notice' and tg.id=o.subject_id and tg.owner_id=o.owner_id;
  return result;
end;
$function$;
alter function internal.claim_supported_notification_outbox(text[],integer) owner to postgres;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;

notify pgrst,'reload schema';
commit;
