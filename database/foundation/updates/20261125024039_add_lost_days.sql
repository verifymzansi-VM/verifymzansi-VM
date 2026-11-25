-- Add lost days to a member's paid slots and package (launch checklist item
-- 75). The posting terms (posting-v6) promise that when we fail to provide
-- what a member paid for, or a suspension is overturned, we first add the days
-- they lost, and that a package's slots still end together. Until now no
-- command could move a paid end date.
--
-- From this update, in one transaction:
--
-- 1. New append-only private.lost_day_additions: one row per paid grant
--    (private.entitlements) a staff member moved, with the request, the staff
--    member, the days added (1 to 30), the grant's start and end before and
--    after, the reason (5 to 500 characters) and the time. Row level security
--    on, no grants to any API role; updates, deletes and truncation are refused
--    (internal.append_only_guard), except the deletes the retention job makes
--    with the grant itself (on delete cascade, under vm.retention).
-- 2. New staff read api.get_lost_days_preview(p_email): the member's running
--    paid terms, so staff never act blind. One item per Individual slot (its
--    first grant's id, its slots, how many renewals are queued, its paid end)
--    and one for a Multi-listing package (the package id, its slots, its end).
--    Capability payments:view (admins, the 12-hour rule).
-- 3. New staff command api.add_lost_days(p_email, p_days, p_reason,
--    p_request_id): adds p_days (1 to 30) to every running paid term of the
--    member. Capability payments:refund (admins, an authenticator code from the
--    last 15 minutes): adding days is the remedy the terms offer before a
--    refund. It moves only the member's live paid grants: source
--    'retail_paid', status 'active', a complete payment and an end still in
--    the future. A running grant ends p_days later; a queued renewal (it starts
--    in the future) starts and ends p_days later, so the slot's chain stays
--    unbroken and its paid end moves by exactly p_days; every grant of a
--    package (its opening grant and slots added part-way) ends p_days later,
--    so they still end together. Ended, refunded, charged-back and pending
--    grants, free credits, house slots, free trials and sponsorships are never
--    moved; an ended slot gets a refund instead (owner's decision). The search
--    end of the posts in those slots follows at once
--    (internal.refresh_slot_chain_documents, internal.refresh_package_documents);
--    each post's own end follows when the lifecycle job reaches it, as for any
--    renewal. Nothing is charged, invoiced or emailed, and no commission
--    changes.
--    Rules: the staff rule of money actions (internal.assert_staff_payment_actor:
--    the staff member has an accepted ID review of their own and never acts for
--    their own account or the same person's); an active account for the email
--    (PT409 lost_days_member_not_found); 1 to 30 days (22023
--    lost_days_days_invalid); a reason of 5 to 500 characters on one line
--    (22023 lost_days_reason_required); a request id (22023
--    lost_days_request_invalid); at least one running paid term (PT409
--    lost_days_nothing_running). One change at a time per member: the command
--    takes the advisory lock package deliveries take ('slot-package:'||member),
--    then locks the grants in id order (as renewal delivery does), checks the
--    staff member again after the wait and reads the grants again: when a
--    payment delivered meanwhile changed them, it refuses (PT409
--    lost_days_busy) and staff try again. A repeated request id with the same
--    member, days and reason returns the first answer and adds nothing (with
--    "repeated": true); with anything else it is refused (PT409
--    lost_days_request_reused).
-- 4. internal.frontend_privacy_export_data (full body) adds the dataset
--    lost_day_additions: the days added to the member's grants (grant, days,
--    dates before and after, reason, time), never the staff member. The staff
--    export reader accepts more datasets than its minimum, so the live website
--    reads the export unchanged.
--
-- Expand only: a table, four new functions and one replaced body; no command,
-- argument or grant is removed or changed. ORDER: apply first, then merge: the
-- Deploy gate probes every command of runtime-api-manifest.json, and the live
-- website reads nothing new.
-- It refuses with 55000 unless internal.frontend_privacy_export_data has its
-- reviewed body (or this update's), each new function is absent (or this
-- update's) and the table is absent or has this update's shape.
-- Read-only preflight: ../preflight/20261125024039_add_lost_days.check.sql.
-- Rollback: ../rollback/20261125024039_add_lost_days.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.frontend_privacy_export_data(uuid)'),
      ('internal.get_lost_days_preview(text)'),
      ('api.get_lost_days_preview(text)'),
      ('internal.add_lost_days(text,integer,text,uuid)'),
      ('api.add_lost_days(text,integer,text,uuid)')) v(sig)
  loop
    if shape not in (
        'internal.frontend_privacy_export_data(uuid) fb567a31cf8ca166f117d5b02f744235',
        'internal.frontend_privacy_export_data(uuid) b0d8e2600a63b8e5b298ee180f488c05',
        'internal.get_lost_days_preview(text) absent',
        'internal.get_lost_days_preview(text) 8174b52a62082b35692a7a7237e2d807',
        'api.get_lost_days_preview(text) absent',
        'api.get_lost_days_preview(text) 9aa7df1fa582cd2ef8d13de8d3eb3536',
        'internal.add_lost_days(text,integer,text,uuid) absent',
        'internal.add_lost_days(text,integer,text,uuid) 62dea7369c8a91b2844e2af0dca77ad0',
        'api.add_lost_days(text,integer,text,uuid) absent',
        'api.add_lost_days(text,integer,text,uuid) 0e5793d459a7acf45a436a4f3133bfb8') then
      raise exception 'lost days precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  if to_regclass('private.lost_day_additions') is not null and (
      select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod),',' order by a.attnum)
      from pg_attribute a where a.attrelid=to_regclass('private.lost_day_additions') and a.attnum>0 and not a.attisdropped)
      is distinct from 'id:uuid,request_id:uuid,entitlement_id:uuid,actor_id:uuid,days:integer,'
        ||'starts_before:timestamp with time zone,starts_after:timestamp with time zone,'
        ||'ends_before:timestamp with time zone,ends_after:timestamp with time zone,reason:text,'
        ||'created_at:timestamp with time zone' then
    raise exception 'lost days precondition: private.lost_day_additions has another shape' using errcode='55000';
  end if;
end$$;

-- 1. The record of every day added.
create table if not exists private.lost_day_additions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  entitlement_id uuid not null references private.entitlements(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  days integer not null check (days between 1 and 30),
  starts_before timestamptz not null,
  starts_after timestamptz not null,
  ends_before timestamptz not null,
  ends_after timestamptz not null,
  reason text not null check (char_length(reason) between 5 and 500),
  created_at timestamptz not null default statement_timestamp(),
  constraint lost_day_additions_request_grant unique (request_id, entitlement_id),
  constraint lost_day_additions_dates check (starts_after >= starts_before and ends_after > ends_before)
);
alter table private.lost_day_additions owner to postgres;
alter table private.lost_day_additions enable row level security;
revoke all on private.lost_day_additions from public, anon, authenticated, service_role;
create index if not exists lost_day_additions_entitlement_idx on private.lost_day_additions (entitlement_id, created_at);
create index if not exists lost_day_additions_actor_idx on private.lost_day_additions (actor_id);
drop trigger if exists lost_day_additions_append_only on private.lost_day_additions;
create trigger lost_day_additions_append_only before update or delete on private.lost_day_additions
  for each row execute function internal.append_only_guard();
drop trigger if exists lost_day_additions_no_truncate on private.lost_day_additions;
create trigger lost_day_additions_no_truncate before truncate on private.lost_day_additions
  for each statement execute function internal.append_only_guard();
comment on table private.lost_day_additions is 'Lost days (20261125024039_add_lost_days.sql): every paid grant a staff member moved to add days a member lost, with the reason. Append-only; deleted only with the grant (commerce retention).';

-- 2. What would move: the member's running paid terms.
create or replace function internal.get_lost_days_preview(p_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare
  actor uuid := internal.staff_actor('payments:view');
  v_member uuid;
begin
  select u.id into v_member from auth.users u
    where lower(u.email)=lower(btrim(p_email)) and u.deleted_at is null and u.is_anonymous is false;
  if v_member is null or not exists(select 1 from private.current_account_access a where a.id=v_member) then
    raise exception 'lost days: no active member account has this email' using errcode='PT409',
      detail='lost_days_member_not_found';
  end if;
  perform internal.assert_staff_payment_actor(actor, v_member);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('kind', g.kind, 'id', g.id, 'slots', g.slots, 'renewals', g.renewals,
        'ends_at', g.ends_at) order by g.ends_at, g.id)
    from (
      select case when bool_and(e.package_id is null) then 'individual' else 'package' end as kind,
        coalesce(e.package_id, e.slot_id, e.id) as id,
        case when bool_and(e.package_id is null) then max(e.slot_capacity) else sum(e.slot_capacity) end::integer as slots,
        (count(*) filter (where e.starts_at>statement_timestamp()))::integer as renewals,
        max(e.ends_at) as ends_at
      from private.entitlements e
        join private.payments pay on pay.id=e.payment_id and pay.status='complete'
      where e.owner_id=v_member and e.source='retail_paid' and e.status='active'
        and e.ends_at>statement_timestamp()
      group by 2
    ) g), '[]'::jsonb));
end;
$function$;
alter function internal.get_lost_days_preview(text) owner to postgres;
revoke all on function internal.get_lost_days_preview(text) from public, anon, authenticated, service_role;
grant execute on function internal.get_lost_days_preview(text) to authenticated;

create or replace function api.get_lost_days_preview(p_email text)
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $function$
  select internal.get_lost_days_preview(p_email);
$function$;
alter function api.get_lost_days_preview(text) owner to postgres;
revoke all on function api.get_lost_days_preview(text) from public, anon, authenticated, service_role;
grant execute on function api.get_lost_days_preview(text) to authenticated;

-- 3. Adding the days.
create or replace function internal.add_lost_days(p_email text, p_days integer, p_reason text, p_request_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare
  actor uuid := internal.staff_actor('payments:refund');
  v_member uuid;
  v_prior record;
  v_locked uuid[];
  v_current uuid[];
  v_target uuid;
  v_now timestamptz := statement_timestamp();
begin
  if p_request_id is null then
    raise exception 'lost days: a request id is required' using errcode='22023', detail='lost_days_request_invalid';
  end if;
  if p_days is null or p_days not between 1 and 30 then
    raise exception 'lost days: choose 1 to 30 days' using errcode='22023', detail='lost_days_days_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, false), false) then
    raise exception 'lost days: a reason of 5 to 500 characters is required' using errcode='22023',
      detail='lost_days_reason_required';
  end if;
  select u.id into v_member from auth.users u
    where lower(u.email)=lower(btrim(p_email)) and u.deleted_at is null and u.is_anonymous is false;
  if v_member is null or not exists(select 1 from private.current_account_access a where a.id=v_member) then
    raise exception 'lost days: no active member account has this email' using errcode='PT409',
      detail='lost_days_member_not_found';
  end if;
  perform internal.assert_staff_payment_actor(actor, v_member);
  -- One change at a time per member, and never beside a package delivery.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||v_member::text, 707));
  -- A repeated request answers as the first did and adds nothing.
  select count(*) as n, bool_and(e.owner_id is not distinct from v_member) as same_member,
      bool_and(r.days=p_days and r.reason=p_reason) as same_input
    into v_prior
    from private.lost_day_additions r left join private.entitlements e on e.id=r.entitlement_id
    where r.request_id=p_request_id;
  if v_prior.n>0 and not (v_prior.same_member and v_prior.same_input) then
    raise exception 'lost days: this request id was already used for another change' using errcode='PT409',
      detail='lost_days_request_reused';
  end if;
  if v_prior.n=0 then
    -- The running paid grants, locked in id order (as renewal delivery locks a slot's grants).
    select array_agg(l.id order by l.id) into v_locked from (
      select e.id from private.entitlements e
        join private.payments pay on pay.id=e.payment_id and pay.status='complete'
      where e.owner_id=v_member and e.source='retail_paid' and e.status='active' and e.ends_at>v_now
      order by e.id for update of e) l;
    actor := internal.staff_actor('payments:refund'); -- authority after the waits
    select array_agg(e.id order by e.id) into v_current from private.entitlements e
      join private.payments pay on pay.id=e.payment_id and pay.status='complete'
    where e.owner_id=v_member and e.source='retail_paid' and e.status='active' and e.ends_at>v_now;
    if v_current is distinct from v_locked then
      raise exception 'lost days: the member''s slots changed just now; try again' using errcode='PT409',
        detail='lost_days_busy';
    end if;
    if v_locked is null then
      raise exception 'lost days: this member has no running paid slot or package' using errcode='PT409',
        detail='lost_days_nothing_running';
    end if;
    insert into private.lost_day_additions(request_id, entitlement_id, actor_id, days, starts_before, starts_after,
        ends_before, ends_after, reason)
      select p_request_id, e.id, actor, p_days, e.starts_at,
        case when e.starts_at>v_now then e.starts_at+make_interval(days=>p_days) else e.starts_at end,
        e.ends_at, e.ends_at+make_interval(days=>p_days), p_reason
      from private.entitlements e where e.id=any(v_locked);
    update private.entitlements e set starts_at=r.starts_after, ends_at=r.ends_after
      from private.lost_day_additions r where r.request_id=p_request_id and r.entitlement_id=e.id;
    -- The search end of the posts in these slots follows now.
    for v_target in select distinct coalesce(e.slot_id, e.id) from private.entitlements e where e.id=any(v_locked) loop
      perform internal.refresh_slot_chain_documents(v_target);
    end loop;
    for v_target in select distinct e.package_id from private.entitlements e
        where e.id=any(v_locked) and e.package_id is not null loop
      perform internal.refresh_package_documents(v_target);
    end loop;
  end if;
  return jsonb_build_object('request_id', p_request_id, 'days', p_days, 'repeated', v_prior.n>0,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('kind', g.kind, 'id', g.id, 'slots', g.slots, 'renewals', g.renewals,
          'ends_before', g.ends_before, 'ends_after', g.ends_after) order by g.ends_before, g.id)
      from (
        select case when bool_and(e.package_id is null) then 'individual' else 'package' end as kind,
          coalesce(e.package_id, e.slot_id, e.id) as id,
          case when bool_and(e.package_id is null) then max(e.slot_capacity) else sum(e.slot_capacity) end::integer as slots,
          (count(*) filter (where r.starts_after>r.starts_before))::integer as renewals,
          max(r.ends_before) as ends_before, max(r.ends_after) as ends_after
        from private.lost_day_additions r join private.entitlements e on e.id=r.entitlement_id
        where r.request_id=p_request_id
        group by 2
      ) g), '[]'::jsonb));
end;
$function$;
alter function internal.add_lost_days(text,integer,text,uuid) owner to postgres;
revoke all on function internal.add_lost_days(text,integer,text,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.add_lost_days(text,integer,text,uuid) to authenticated;

create or replace function api.add_lost_days(p_email text, p_days integer, p_reason text, p_request_id uuid)
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $function$
  select internal.add_lost_days(p_email, p_days, p_reason, p_request_id);
$function$;
alter function api.add_lost_days(text,integer,text,uuid) owner to postgres;
revoke all on function api.add_lost_days(text,integer,text,uuid) from public, anon, authenticated, service_role;
grant execute on function api.add_lost_days(text,integer,text,uuid) to authenticated;

-- 4. The member's privacy export lists the days added to their grants.
CREATE OR REPLACE FUNCTION internal.frontend_privacy_export_data(p_subject uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare entry record;items jsonb;row_count integer;result jsonb:='{}';size_so_far bigint:=0;
begin
  for entry in select * from (values
    ('profile',$q$select account_id,display_name,bio,legal_first_name,legal_last_name,legal_name_locked_at,created_at,updated_at from private.profiles where account_id=$1$q$),
    ('account',$q$select id,email,email_confirmed_at,phone,phone_confirmed_at,created_at,last_sign_in_at from auth.users where id=$1 and deleted_at is null$q$),
    ('listing_drafts',$q$select category_key,price_mode,price_cents,price_negotiable,revision,expires_at from private.listing_price_drafts where owner_id=$1$q$),
    ('post_templates',$q$select id,kind,name,data,created_at,updated_at from private.post_templates where owner_id=$1 order by created_at,id$q$),
    ('posts',$q$select p.id,p.kind,p.area,p.category_key,p.activity_key,p.title,p.description,p.province_id,p.city_id,p.locality_label,
      p.status,p.status_reason,p.created_at,p.submitted_at,p.published_at,p.visible_until,p.edit_of,
      l.price_mode,l.price_cents,l.price_negotiable,l.attributes,b.business_type,e.starts_at,e.ends_at,e.timezone,
      s.slug,d.data presentation,d.contacts contact_details,c.channels,cp.source_post_id copied_from
      from private.posts p left join private.listing_details l on l.post_id=p.id left join private.business_details b on b.post_id=p.id
      left join private.event_details e on e.post_id=p.id left join private.post_slugs s on s.post_id=p.id
      left join private.post_presentations d on d.post_id=p.id left join private.post_contacts c on c.post_id=p.id
      left join private.post_copies cp on cp.post_id=p.id
      where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('post_reviews',$q$select m.post_id,m.edit_id,m.decision,m.reason,m.decided_at,m.price_only
      from private.moderation_log m join private.posts p on p.id=m.post_id where p.owner_id=$1 order by m.decided_at,m.id$q$),
    ('media_metadata',$q$select id,kind,size_bytes,mime,width,height,state,created_at,deleted_at from private.media_objects where owner_id=$1 order by created_at,id$q$),
    ('payments',$q$select p.id,p.product_kind,p.target_post_id,p.amount_cents,p.currency,p.status,p.fulfillment_status,p.merchant_reference,
      p.provider,p.created_at,p.completed_at,coalesce((p.snapshot->>'renewal')::boolean,false) renewal,
      p.snapshot->'cooling_off_consent' cooling_off_consent,p.snapshot->'renewal_starts' renewal_starts,
      (select jsonb_agg(jsonb_build_object('line_number',l.line_number,'amount_cents',l.amount_cents,'status',l.status,
          'renews_entitlement_id',l.renews_entitlement_id,'slot_count',l.slot_count,'reversal_kind',l.reversal_kind,
          'reversed_at',l.reversed_at)
        order by l.line_number) from private.payment_lines l where l.payment_id=p.id) lines
      from private.payments p where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('invoices',$q$select i.id,i.payment_id,i.invoice_number,i.amount_ex_vat_cents,i.vat_cents,i.total_cents,i.description,i.issued_at
      from private.invoices i join private.payments p on p.id=i.payment_id where p.owner_id=$1 order by i.issued_at,i.id$q$),
    ('customer_invoices',$q$select i.invoice_number,i.status,i.description,i.slots,i.unit_price_cents,i.total_cents,i.issued_at,i.due_on,
      i.buyer_name,i.buyer_address,i.buyer_registration_number,i.buyer_saved_at,i.cooling_off_consent_at,i.cooling_off_consent_version,
      i.payment_id,i.paid_at,i.voided_at,(select array_agg(l.payment_id order by l.attempt) from private.customer_invoice_payments l
        where l.invoice_id=i.id) payment_attempts
      from private.customer_invoices i where i.account_id=$1 order by i.issued_at,i.id$q$),
    ('bank_transfers',$q$select t.id,t.payment_id,v.duration_days term_days,t.slots,t.amount_received_cents,t.bank_reference,t.cleared_on,
      t.cooling_off_waiver_confirmed,t.status,t.recorded_at,t.confirmed_at,t.declined_at,t.expired_at
      from private.invoice_transfers t join private.plan_versions v on v.id=t.plan_version_id where t.account_id=$1 order by t.recorded_at,t.id$q$),
    ('entitlements',$q$select id,source,area,slot_capacity,activations_per_period,activation_period_days,max_photos,max_videos,starts_at,ends_at,status,revoked_reason,
      renews_entitlement_id,slot_id,package_id
      from private.entitlements where owner_id=$1 order by created_at,id$q$),
    ('house_slot_events',$q$select h.entitlement_id,h.action,h.ends_at,h.recorded_at from private.house_slot_events h
      join private.entitlements e on e.id=h.entitlement_id where e.owner_id=$1 order by h.recorded_at,h.id$q$),
    ('lost_day_additions',$q$select r.entitlement_id,r.days,r.starts_before,r.starts_after,r.ends_before,r.ends_after,r.reason,r.created_at
      from private.lost_day_additions r join private.entitlements e on e.id=r.entitlement_id where e.owner_id=$1 order by r.created_at,r.id$q$),
    ('slot_packages',$q$select id,term_days,slot_count,created_at from private.slot_packages where owner_id=$1
      order by created_at,id$q$),
    ('package_invoice_requests',$q$select r.id,r.term_days,r.slots,r.unit_price_cents,r.total_cents,r.requested_at,r.consent_at,
      r.consent_version,r.status,r.closed_at,(select i.invoice_number from private.customer_invoices i where i.id=r.invoice_id) invoice_number,
      r.kind,r.package_id,r.days_left,r.invoiced_days
      from private.package_invoice_requests r where r.account_id=$1 order by r.requested_at,r.id$q$),
    ('post_activations',$q$select post_id,entitlement_id,activated_at,released_at,release_reason,continued
      from private.post_activations where owner_id=$1 order by activated_at,id$q$),
    ('event_submissions',$q$select post_id,submitted_at,released_at,release_reason
      from private.event_submissions where owner_id=$1 order by submitted_at,id$q$),
    ('introductory_trials',$q$select post_id,trial_entitlement_id,claimed_at,converted_at
      from private.post_trial_claims where owner_id=$1 order by claimed_at,post_id$q$),
    ('posting_terms',$q$select version,document_hash,accepted_at from private.posting_terms_acceptances where owner_id=$1 order by accepted_at,version$q$),
    ('signup_terms',$q$select version,document_hash,method,accepted_at from private.signup_terms_acceptances where account_id=$1$q$),
    ('communication_choices',$q$select purpose,granted,wording_version,recorded_at from private.communication_choice_events
      where account_id=$1 order by recorded_at,id$q$),
    ('verification_cases',$q$select id,kind,status,created_at from private.evidence_cases where subject_id=$1 order by created_at,id$q$),
    ('verification_reviews',$q$select r.case_id,r.reason,r.decision,r.created_at from private.verification_return_requests r join private.evidence_cases c on c.id=r.case_id
      where c.subject_id=$1 order by r.created_at,r.id$q$),
    ('evidence_metadata',$q$select id,case_id,purpose,state,size_bytes,created_at,retain_until,deleted_at
      from private.evidence_artifacts where owner_id=$1 order by created_at,id$q$),
    ('phone_verification',$q$select phone,verified_at,contact_changed_at,revoked_at from private.verification_phone_proofs where owner_id=$1 order by verified_at,id$q$),
    ('locality_verification',$q$select province_id,city_id,assurance,confirmed_at from private.verification_localities where owner_id=$1$q$),
    ('enquiries_sent',$q$select id,post_id,message,created_at from private.enquiries where sender_account_id=$1 order by created_at,id$q$),
    ('enquiries_received',$q$select id,post_id,message,status,created_at from private.enquiries where owner_id=$1 order by created_at,id$q$),
    ('post_likes',$q$select l.post_id,l.created_at from (select post_id,created_at,id from private.post_likes
      where account_id=$1 order by created_at desc,id limit 2000) l$q$),
    ('post_likes_summary',$q$select count(*) total,min(created_at) first_at,max(created_at) last_at
      from private.post_likes where account_id=$1$q$),
    ('notifications',$q$select id,kind,post_id,created_at,read_at from private.notifications where account_id=$1 order by created_at,id$q$),
    ('reports_submitted',$q$select id,post_id,coalesce(frontend_reason,category) category,description,status,created_at,resolved_at
      from private.reports where reporter_id=$1 order by created_at,id$q$),
    ('moderation_decisions',$q$select id,kind,reason,starts_at,ends_at,active from private.frontend_appealable_actions
      where account_id=$1 order by starts_at,id$q$),
    ('appeals',$q$select id,action_id,kind,reason,status,reviewer_rationale,created_at,resolved_at from private.frontend_appeals
      where appellant_id=$1 order by created_at,id$q$),
    ('organisation_applications',$q$select id,organisation_id,programme_id,post_id,reason,member_reference,share_representative_name,consented_at,
      status,info_request,info_response,decision_at,decision_note,created_at from private.organisation_applications where applicant_id=$1 order by created_at,id$q$),
    ('organisation_affiliations',$q$select a.id,a.organisation_id,a.programme_id,a.post_id,a.affiliation_type,a.status,a.confirmed_at,a.revoked_at,a.revoke_reason
      from private.organisation_affiliations a join private.posts p on p.id=a.post_id where p.owner_id=$1 order by a.created_at,a.id$q$),
    ('organisation_roles',$q$select organisation_id,role,created_at from private.organisation_admins where account_id=$1 order by created_at,organisation_id$q$),
    ('sponsorships',$q$select id,organisation_id,post_id,sponsor_type,status,starts_at,ends_at,ended_at,end_reason
      from private.organisation_sponsorships where owner_id=$1 order by created_at,id$q$),
    ('partner_account',$q$select id,code,status,commission_bps,created_at,updated_at from private.partners where account_id=$1 order by created_at,id$q$),
    ('partner_commissions',$q$select c.id,c.base_cents,c.rate_bps,c.amount_cents,c.status,c.eligible_at,c.approved_at,c.paid_at,c.reversed_at
      from private.partner_commissions c join private.partners p on p.id=c.partner_id where p.account_id=$1 order by c.created_at,c.id$q$),
    ('acquisition',$q$select source,campaign,landing_path,referrer_host,first_touch_at,recorded_at from private.account_acquisitions where account_id=$1$q$),
    ('account_closure',$q$select closed_at,evidence_delete_after from private.account_closures where user_id=$1$q$),
    ('data_requests',$q$select id,type,description,status,received_at,due_by,extended_due_at,extension_reason,response_summary,completed_at
      from private.privacy_requests where subject_user_id=$1 order by received_at,id$q$)
  ) as registry(dataset,statement) loop
    execute 'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb),count(*) from ('||entry.statement||' limit 2501)x'
      into items,row_count using p_subject;
    size_so_far:=size_so_far+octet_length(items::text);
    if row_count>2500 or size_so_far>4194304 then raise exception 'privacy export exceeds the direct delivery limit' using errcode='PT413';end if;
    result:=result||jsonb_build_object(entry.dataset,items);
  end loop;
  return result;
end$function$;
alter function internal.frontend_privacy_export_data(uuid) owner to postgres;
revoke all on function internal.frontend_privacy_export_data(uuid) from public;

commit;
