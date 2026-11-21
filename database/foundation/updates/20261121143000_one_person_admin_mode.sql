-- Single-administrator mode for house slots, logged (owner's decision of 21
-- November 2026, launch checklist item 67).
--
-- While the platform has exactly one ID-verified staff member, the two-person
-- rules for house slots cannot be met: the owner's second admin account has no
-- accepted ID review of its own (one person, one ID). From this update, while
-- that single ID-verified staff member exists:
--
-- 1. internal.grant_house_slots (database owner only, run in the Supabase SQL
--    editor; still executable by no API role) accepts the recipient as their
--    own approver: p_approved_by_email may name the recipient's own account
--    when internal.single_administrator(recipient) holds. Every other rule is
--    unchanged (confirmed, active account, active admin role, accepted ID
--    review, verified authenticator app, a written reason of 5 to 500
--    characters, read committed). Each slot event it records is marked
--    self_granted (new column of the append-only private.house_slot_events).
-- 2. The house-slot cap rises from 15 to 25 for every grant (a count outside
--    1 to 25 is refused with 22023 house_slots_count_invalid).
-- 3. That staff member may review their own pending post when one of their
--    own house slots funds it (for an edit: the live post it edits):
--    internal.queue_conflict no longer counts it as a conflict, so it is
--    listed, claimed and opened like any other post (the moderation queue,
--    internal.claim_queue_items, internal.claim_queue_item,
--    internal.staff_review_post). internal.claim_queue_items and the
--    approval check internal.assert_posting_verification_ready now ask
--    internal.queue_conflict instead of comparing the owner themselves.
-- 4. internal.moderate_post lets them approve (never reject) such a post. As
--    for every moderation decision, the admin role's post:moderate needs an
--    authenticator code from the last 15 minutes (internal.staff_actor, 42501
--    "recent second-factor verification required"); the update refuses to
--    run unless that capability still requires it. The decision is recorded
--    with self_approved (new column of the append-only private.moderation_log)
--    and the staff Audit log shows it as post:self_approved.
--
-- internal.single_administrator(account) works the mode out at every call,
-- with no stored flag: the account holds an active admin role and an accepted
-- ID review (internal.current_verified_identity), and no other account with
-- an active staff role has one. As soon as a second staff member's ID review
-- is accepted, every grant needs a second ID-verified administrator again and
-- every own post is a conflict again, also for an item already claimed.
-- Identity reviews, refunds, business checks, reports and every other
-- two-person rule are unchanged.
--
-- No API command, argument, grant or result field changes (internal functions,
-- two new columns with a default, one audit view branch). ORDER: apply first,
-- then merge. It refuses with 55000 unless each function it replaces has its
-- reviewed body (or this update's), internal.single_administrator is absent
-- (or this update's), the staff audit view is the reviewed one (or this
-- update's) and both new columns are absent or both present.
-- Read-only preflight: ../preflight/20261121143000_one_person_admin_mode.check.sql.
-- Rollback: ../rollback/20261121143000_one_person_admin_mode.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare shape text; columns integer;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.grant_house_slots(text,integer,integer,text,text)'),
      ('internal.queue_conflict(uuid,uuid,uuid)'),
      ('internal.claim_queue_items(text,integer)'),
      ('internal.moderate_post(uuid,integer,text,text,text,uuid)'),
      ('internal.assert_posting_verification_ready(uuid,boolean)'),
      ('internal.single_administrator(uuid)')) v(sig)
  loop
    if shape not in (
        'internal.grant_house_slots(text,integer,integer,text,text) 77527fd29f2348e228441612a842cce2',
        'internal.grant_house_slots(text,integer,integer,text,text) 6d72e0bc6a5f2bee76a43563f19278ac',
        'internal.queue_conflict(uuid,uuid,uuid) 7ef9b54c11a14dfe2f71b4e7ec474b44',
        'internal.queue_conflict(uuid,uuid,uuid) 87bdbc5e0894a7bdb5b7db6c2c88b32d',
        'internal.claim_queue_items(text,integer) fc822bf9b962527b0fba39c22d364735',
        'internal.claim_queue_items(text,integer) f9de196ff57fbb40b2e39d587e8d5db8',
        'internal.moderate_post(uuid,integer,text,text,text,uuid) 1f127647b461014ddc3d6d6ef6d086c7',
        'internal.moderate_post(uuid,integer,text,text,text,uuid) f8530350bc34d6191ba35d62cc74087b',
        'internal.assert_posting_verification_ready(uuid,boolean) c54fe760620720d67cf17c644623bd6f',
        'internal.assert_posting_verification_ready(uuid,boolean) 45e28fa96d190f50aa15b1a106685680',
        'internal.single_administrator(uuid) absent',
        'internal.single_administrator(uuid) 86df529201fa210e43106b1ad93a16ff') then
      raise exception 'one-person admin mode precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  if md5(pg_get_viewdef('private.frontend_staff_nonpayment_audit_events'::regclass)) not in ('5848686f27e6a4c7987378e9ba379247', 'b251677f8db6064fb8f08e1c040b4794') then
    raise exception 'one-person admin mode precondition: private.frontend_staff_nonpayment_audit_events is not the reviewed view'
      using errcode='55000';
  end if;
  select count(*) into columns from pg_attribute a
    where (a.attrelid, a.attname) in (('private.moderation_log'::regclass, 'self_approved'),
      ('private.house_slot_events'::regclass, 'self_granted')) and not a.attisdropped;
  if columns not in (0, 2) then
    raise exception 'one-person admin mode precondition: % of 2 new columns exist', columns using errcode='55000';
  end if;
  if not exists(select 1 from private.staff_capabilities c
      where c.role='admin' and c.capability='post:moderate' and c.requires_recent_mfa) then
    raise exception 'one-person admin mode precondition: the admin role''s post:moderate must require a recent second factor'
      using errcode='55000';
  end if;
end$$;

-- 1. The marks on the two append-only records (existing rows: false).
alter table private.house_slot_events add column if not exists self_granted boolean not null default false;
alter table private.house_slot_events drop constraint if exists house_slot_events_self_granted_check;
alter table private.house_slot_events add constraint house_slot_events_self_granted_check
  check (not self_granted or action in ('granted', 'extended'));
comment on column private.house_slot_events.self_granted is 'Granted or extended in single-administrator mode: the only ID-verified staff member approved a grant to their own admin account (internal.grant_house_slots).';
alter table private.moderation_log add column if not exists self_approved boolean not null default false;
alter table private.moderation_log drop constraint if exists moderation_log_self_approved_check;
alter table private.moderation_log add constraint moderation_log_self_approved_check
  check (not self_approved or decision = 'approve');
comment on column private.moderation_log.self_approved is 'Approved in single-administrator mode: the only ID-verified staff member approved their own post funded by one of their house slots (internal.moderate_post).';

-- 2. The mode, worked out at every call.
create or replace function internal.single_administrator(p_account uuid)
 returns boolean
 language sql
 stable
 set search_path to 'pg_catalog'
as $function$
  -- Single-administrator mode: the account holds an active admin role and an
  -- accepted ID review, and no other account with an active staff role has
  -- one. Never stored: a second ID-verified staff member ends it at once.
  select exists(select 1 from private.staff_roles r
      where r.user_id=p_account and r.role='admin' and r.revoked_at is null)
    and internal.current_verified_identity(p_account) is not null
    and not exists(select 1 from private.staff_roles r
      where r.revoked_at is null and r.user_id<>p_account
        and internal.current_verified_identity(r.user_id) is not null);
$function$;
alter function internal.single_administrator(uuid) owner to postgres;
revoke all on function internal.single_administrator(uuid) from public, anon, authenticated, service_role;

-- 3. House slots: up to 25; a self-grant in single-administrator mode.
create or replace function internal.grant_house_slots(p_recipient_email text, p_slots integer, p_days integer, p_reason text, p_approved_by_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare v_recipient uuid; v_approver uuid; v_identity text; v_approver_identity text; v_ends timestamptz;
  v_held uuid[]; v_slot private.entitlements; v_self boolean;
  v_id uuid; v_added integer:=0; v_extended integer:=0;
begin
  -- The count of slots already held is read after the staff role lock; only
  -- read committed sees a grant that committed while this one waited.
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'house slots: run this command in a read committed transaction' using errcode='55000',
      detail='house_slots_isolation';
  end if;
  if p_slots is null or p_slots<1 or p_slots>25 then
    raise exception 'house slots: choose 1 to 25 slots' using errcode='22023', detail='house_slots_count_invalid';
  end if;
  if p_days is null or p_days<7 or p_days>180 then
    raise exception 'house slots: choose a term of 7 to 180 days' using errcode='22023', detail='house_slots_term_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'house slots: a written reason of 5 to 500 characters is required' using errcode='22023',
      detail='house_slots_reason_required';
  end if;
  select u.id into v_recipient from auth.users u
    where lower(u.email)=lower(btrim(p_recipient_email)) and u.email_confirmed_at is not null and u.is_anonymous is false;
  select u.id into v_approver from auth.users u
    where lower(u.email)=lower(btrim(p_approved_by_email)) and u.email_confirmed_at is not null and u.is_anonymous is false;
  if v_recipient is null then
    raise exception 'house slots: a confirmed recipient account is required' using errcode='42501',
      detail='house_slots_recipient_invalid';
  end if;
  if v_approver is null then
    raise exception 'house slots: a confirmed approving administrator account is required' using errcode='42501',
      detail='house_slots_approver_invalid';
  end if;
  v_self:=v_approver=v_recipient;
  -- Both current staff roles, in one order: a role removal at the same moment
  -- waits for this grant (and then ends what it added), or this grant sees it.
  perform r.id from private.staff_roles r where r.user_id in(v_recipient, v_approver) and r.revoked_at is null
    order by r.id for update;
  if not exists(select 1 from private.staff_roles r where r.user_id=v_recipient and r.role='admin' and r.revoked_at is null) then
    raise exception 'house slots: the recipient must hold an active admin role' using errcode='42501',
      detail='house_slots_not_admin';
  end if;
  if not exists(select 1 from private.current_account_access a where a.id=v_recipient) then
    raise exception 'house slots: the recipient account is not active' using errcode='42501',
      detail='house_slots_recipient_inactive';
  end if;
  v_identity:=internal.current_verified_identity(v_recipient);
  if v_identity is null then
    raise exception 'house slots: the recipient''s ID review must be accepted' using errcode='42501',
      detail='house_slots_identity_required';
  end if;
  if not exists(select 1 from auth.mfa_factors f where f.user_id=v_recipient and f.factor_type='totp' and f.status='verified') then
    raise exception 'house slots: the recipient needs a verified authenticator app' using errcode='42501',
      detail='house_slots_mfa_required';
  end if;
  if v_self then
    -- Single-administrator mode: while the recipient is the only ID-verified
    -- staff member, they approve a grant to their own admin account. Each
    -- event is marked self_granted.
    if not internal.single_administrator(v_recipient) then
      raise exception 'house slots: the approver must be a different administrator account' using errcode='42501',
        detail='house_slots_self_approval';
    end if;
  else
    if not exists(select 1 from private.staff_roles r where r.user_id=v_approver and r.role='admin' and r.revoked_at is null)
      or not exists(select 1 from private.current_account_access a where a.id=v_approver)
      or not exists(select 1 from auth.mfa_factors f where f.user_id=v_approver and f.factor_type='totp' and f.status='verified') then
      raise exception 'house slots: the approver must be an active administrator with a verified authenticator app'
        using errcode='42501', detail='house_slots_approver_invalid';
    end if;
    -- Approval needs a second ID-verified person, not only a second account.
    v_approver_identity:=internal.current_verified_identity(v_approver);
    if v_approver_identity is null then
      raise exception 'house slots: the approver''s ID review must be accepted' using errcode='42501',
        detail='house_slots_approver_identity_required';
    end if;
    if v_approver_identity=v_identity then
      raise exception 'house slots: the approver must be a different person' using errcode='42501',
        detail='house_slots_same_person';
    end if;
  end if;
  v_ends:=statement_timestamp()+make_interval(days=>p_days);
  -- The account's current house slots, locked in the order
  -- internal.activate_post locks slots in (end date, then id).
  select coalesce(array_agg(x.id order by x.ends_at, x.id), '{}') into v_held from (select e.id, e.ends_at
      from private.entitlements e
      where e.owner_id=v_recipient and e.source='staff_grant' and e.status='active'
        and e.starts_at<=statement_timestamp() and e.ends_at>statement_timestamp()
        and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)
      order by e.ends_at, e.id for update) x;
  if cardinality(v_held)>p_slots then
    raise exception 'house slots: the account already holds % house slots; this command only adds or extends them',
      cardinality(v_held) using errcode='22023', detail='house_slots_count_invalid';
  end if;
  for v_slot in select e.* from private.entitlements e where e.id=any(v_held) and e.ends_at<v_ends order by e.ends_at, e.id loop
    update private.entitlements set ends_at=v_ends where id=v_slot.id;
    perform internal.refresh_slot_chain_documents(v_slot.id);
    insert into private.house_slot_events(entitlement_id, action, ends_at, approved_by, reason, self_granted)
      values(v_slot.id, 'extended', v_ends, v_approver, p_reason, v_self);
    v_extended:=v_extended+1;
  end loop;
  for i in 1..(p_slots-cardinality(v_held)) loop
    insert into private.entitlements(owner_id, source, area, granted_by, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values(v_recipient, 'staff_grant', null, v_approver, 1, 4, 30, 10, 1, statement_timestamp(), v_ends, '{}')
      returning id into v_id;
    insert into private.house_slot_events(entitlement_id, action, ends_at, approved_by, reason, self_granted)
      values(v_id, 'granted', v_ends, v_approver, p_reason, v_self);
    v_added:=v_added+1;
  end loop;
  return jsonb_build_object('account_id', v_recipient, 'approved_by', v_approver, 'house_slots', p_slots,
    'added', v_added, 'extended', v_extended, 'self_granted', v_self,
    'slots', (select jsonb_agg(jsonb_build_object('id', e.id, 'ends_at', e.ends_at) order by e.ends_at, e.id)
      from private.entitlements e where e.owner_id=v_recipient and e.source='staff_grant' and e.status='active'
        and e.ends_at>statement_timestamp()
        and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)));
end;
$function$;
alter function internal.grant_house_slots(text,integer,integer,text,text) owner to postgres;
revoke all on function internal.grant_house_slots(text,integer,integer,text,text) from public, anon, authenticated, service_role;

-- 4. Own posts: a conflict, except a house-slot post in single-administrator mode.
create or replace function internal.queue_conflict(p_actor uuid, p_post_id uuid, p_report_id uuid)
 returns boolean
 language sql
 stable
 set search_path to 'pg_catalog'
as $function$
  select case when p_post_id is not null
    then exists(select 1 from private.posts p where p.id=p_post_id and p.owner_id=p_actor)
      -- Single-administrator mode: the only ID-verified staff member may
      -- review their own post when one of their house slots funds it (for an
      -- edit, the live post it edits).
      and not (exists(select 1 from private.posts p
          join private.post_activations a on a.post_id=coalesce(p.edit_of, p.id) and a.released_at is null
          join private.entitlements e on e.id=a.entitlement_id
          where p.id=p_post_id and e.owner_id=p_actor and e.source='staff_grant'
            and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id))
        and internal.single_administrator(p_actor))
    else exists(select 1 from private.reports r where r.id=p_report_id and
      (r.reporter_id=p_actor or r.subject_account_id=p_actor
       or r.duplicate_owner_b=p_actor or r.duplicate_created_by=p_actor))
  end;
$function$;
alter function internal.queue_conflict(uuid,uuid,uuid) owner to postgres;
revoke all on function internal.queue_conflict(uuid,uuid,uuid) from public, anon, authenticated, service_role;

-- 5. Claiming content asks internal.queue_conflict.
create or replace function internal.claim_queue_items(p_queue text, p_limit integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare actor uuid := internal.staff_actor('queue:claim'); allowed integer; r record;
  c private.queue_claims; items jsonb := '[]'::jsonb;
begin
  if p_queue is null or p_queue not in ('content', 'reports') then
    raise exception 'unknown queue' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'claim between 1 and 25 items' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 1201));
  actor := internal.staff_actor('queue:claim'); -- authority after the holder guard wait
  allowed := least(p_limit, 20 - (select count(*) from private.queue_claims q
    where q.claimed_by = actor and q.claim_expires_at > clock_timestamp())::integer);
  if allowed <= 0 then return items; end if;
  -- Scan with headroom: a row another claimer committed after this scan began
  -- is skipped by take_queue_claim, and the next row takes its place.
  if p_queue = 'content' then
    for r in
      select p.id from private.posts p
      where p.status = 'pending_moderation' and not internal.queue_conflict(actor, p.id, null)
        and not exists (select 1 from private.queue_claims q where q.post_id = p.id
          and q.claimed_by is not null and q.claim_expires_at > clock_timestamp())
      order by p.submitted_at, p.id limit allowed * 2
      for update of p skip locked
    loop
      c := internal.take_queue_claim(actor, r.id, null);
      if c.id is not null then items := items || jsonb_build_array(internal.queue_claim_view(c)); end if;
      exit when jsonb_array_length(items) >= allowed;
    end loop;
  else
    for r in
      select x.id from private.reports x
      where x.status = 'open' and not internal.current_report_proposal(x.active_proposal_id) and not internal.queue_conflict(actor,null,x.id)
        and not exists (select 1 from private.queue_claims q where q.report_id = x.id
          and q.claimed_by is not null and q.claim_expires_at > clock_timestamp())
      order by (x.severity = 'high') desc, x.created_at, x.id limit allowed * 2
      for update of x skip locked
    loop
      c := internal.take_queue_claim(actor, null, r.id);
      if c.id is not null then items := items || jsonb_build_array(internal.queue_claim_view(c)); end if;
      exit when jsonb_array_length(items) >= allowed;
    end loop;
  end if;
  perform internal.staff_actor('queue:claim'); -- authority after any claim-row wait
  return items;
end;
$function$;
alter function internal.claim_queue_items(text,integer) owner to postgres;
revoke all on function internal.claim_queue_items(text,integer) from public, anon, authenticated, service_role;
grant execute on function internal.claim_queue_items(text,integer) to authenticated;

-- 6. Approving one's own house-slot post: a fresh authenticator code, logged.
create or replace function internal.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text, p_reason text, p_claim_generation text, p_claim_nonce uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare
  actor uuid := internal.staff_actor('post:moderate');
  post private.posts;
  original_id uuid;
  funded_until timestamptz;
  photo_limit integer;
  video_limit integer;
  rev integer;
  merged jsonb;
  self_approved boolean;
begin
  perform internal.assert_post_revision(p_expected_revision);
  if p_decision is null or p_decision not in ('approve', 'reject')
    or (p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) not between 5 and 500) then
    raise exception 'decision and, for rejections, a reason are required' using errcode = '22023';
  end if;
  -- The owner's subject lock first, as every owner command takes it, so that
  -- starting the free week below never waits for it beneath the post rows.
  perform internal.lock_evidence_subject(p.owner_id) from private.posts p where p.id = p_post_id;
  -- An edit locks its live post before the copy, like every owner command.
  select p.edit_of into original_id from private.posts p where p.id = p_post_id;
  if original_id is not null then
    perform 1 from private.posts p where p.id = original_id for update;
  end if;
  select * into post from private.posts p where p.id = p_post_id for update;
  if not found or post.status <> 'pending_moderation' or post.edit_of is distinct from original_id then
    raise exception 'post is not awaiting moderation' using errcode = '22023';
  end if;
  actor := internal.staff_actor('post:moderate'); -- authority after any lock wait
  -- Single-administrator mode (internal.queue_conflict): the only ID-verified
  -- staff member may approve, never reject, their own post funded by one of
  -- their house slots. post:moderate already needs an authenticator code from
  -- the last 15 minutes (internal.staff_actor, requires_recent_mfa).
  self_approved := post.owner_id = actor;
  if self_approved and (p_decision <> 'approve' or internal.queue_conflict(actor, post.id, null)) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  perform internal.consume_queue_claim('post', post.id, actor, p_claim_generation, p_claim_nonce);
  if post.revision <> p_expected_revision then raise exception 'post changed since review' using errcode = 'PT409'; end if;
  if p_decision='approve' then
    perform internal.assert_post_contacts_ready(post.id,true);
    perform internal.assert_posting_verification_ready(post.id,true);
  end if;
  if p_decision = 'reject' then
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'moderation'
      where post_id = post.id and released_at is null;
    update private.posts set status = 'rejected', status_reason = btrim(p_reason), revision = revision + 1
      where id = post.id;
    -- A rejected post does not use the free week.
    delete from private.intro_trial_requests r where r.post_id = post.id;
  elsif original_id is not null then
    merged := internal.apply_post_edit(original_id, post.id);
    rev := (merged->>'revision')::integer;
  else
    if post.kind='event' then perform internal.assert_event_duplicate_absent(post.id,true); end if;
    if not exists(select 1 from private.current_account_access u where u.id=post.owner_id) then
      raise exception 'post owner is no longer eligible' using errcode='PT409';
    end if;
    -- A post submitted without a plan waits for the free week: its 7 days
    -- start now, at approval.
    if post.kind <> 'event' and exists(select 1 from private.intro_trial_requests r where r.post_id = post.id)
      and not exists(select 1 from internal.post_funding(post.id)) then
      perform internal.start_intro_trial(post.id);
    end if;
    delete from private.intro_trial_requests r where r.post_id = post.id;
    select f.funded_until, f.max_photos, f.max_videos into funded_until, photo_limit, video_limit
      from internal.post_funding(post.id) f;
    if funded_until is null or funded_until <= (case when post.kind='event' then clock_timestamp() else statement_timestamp() end) then
      raise exception 'funding or event window has ended' using errcode = 'PT409';
    end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose='video')>video_limit then
      raise exception 'funded media allowance changed since submission' using errcode='PT409';
    end if;
    update private.posts set status = 'live', published_at = statement_timestamp(), visible_until = funded_until,
      revision = revision + 1 where id = post.id;
    perform internal.write_post_projection(post.id);
    if post.kind='event' and (funded_until<=clock_timestamp() or not exists(
      select 1 from private.current_account_access u where u.id=post.owner_id)) then
      raise exception 'event window or owner is no longer eligible' using errcode='PT409';
    end if;

  end if;
  if p_decision='approve' then
    perform internal.assert_post_contacts_ready(coalesce(original_id,post.id),true);
    perform internal.assert_posting_verification_ready(coalesce(original_id,post.id),true);
  end if;
  perform internal.staff_actor('post:moderate'); -- authority after claim-row and media waits
  insert into private.moderation_log (post_id, edit_id, staff_id, decision, post_revision, reason, price_only, self_approved)
  values (coalesce(original_id, post.id), case when original_id is not null then post.id end, actor, p_decision,
    p_expected_revision, nullif(btrim(coalesce(p_reason, '')), ''), coalesce((merged->>'price_only')::boolean, false),
    self_approved);
  if original_id is not null then
    return jsonb_build_object('id', post.id, 'edit_of', original_id,
      'status', case when p_decision = 'approve' then 'merged' else 'rejected' end, 'post_revision', rev,
      'price_only', coalesce((merged->>'price_only')::boolean, false));
  end if;
  return jsonb_build_object('id', post.id, 'status', case when p_decision = 'approve' then 'live' else 'rejected' end,
    'visible_until', funded_until);
end;
$function$;
alter function internal.moderate_post(uuid,integer,text,text,text,uuid) owner to postgres;
revoke all on function internal.moderate_post(uuid,integer,text,text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.moderate_post(uuid,integer,text,text,text,uuid) to authenticated;

-- 7. The posting check at approval asks internal.queue_conflict too.
create or replace function internal.assert_posting_verification_ready(p_post_id uuid, p_staff boolean)
 returns void
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
declare actor uuid; owner uuid; ready boolean;
begin
  if p_staff is null then raise exception 'caller context required' using errcode='22023'; end if;
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  select p.owner_id into owner from private.posts p where p.id=p_post_id;
  ready:=internal.current_verified_identity(owner) is not null;
  -- No new verification/evidence locks beneath post/media locks. Read canonical
  -- current facts and rederive the real caller before a data-dependent refusal.
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  if owner is null then raise exception 'post unavailable' using errcode='22023'; end if;
  -- Staff never publish their own post, except in single-administrator mode
  -- (internal.queue_conflict).
  if (not p_staff and owner<>actor) or (p_staff and internal.queue_conflict(actor, p_post_id, null)) then
    raise exception 'caller cannot publish this post' using errcode='42501';
  end if;
  if not ready then
    raise exception 'complete identity verification before posting' using errcode='42501',
      detail='posting_verification_required';
  end if;
end;
$function$;
alter function internal.assert_posting_verification_ready(uuid,boolean) owner to postgres;
revoke all on function internal.assert_posting_verification_ready(uuid,boolean) from public, anon, authenticated, service_role;

-- 8. The staff Audit log shows a self-approval as post:self_approved; every
-- other branch is unchanged.
create or replace view private.frontend_staff_nonpayment_audit_events with (security_invoker=true) as
 SELECT 'moderation:'::text || m.id::text AS id,
    m.decided_at AS occurred_at,
    m.staff_id AS actor_id,
    m.post_id AS target_id,
    'post'::text AS target_type,
        CASE
            WHEN m.self_approved THEN 'post:self_approved'::text
            ELSE 'post:'::text || m.decision
        END AS action,
    m.reason
   FROM private.moderation_log m
UNION ALL
 SELECT 'evidence_access:'::text || e.id::text AS id,
    e.accessed_at AS occurred_at,
    e.staff_id AS actor_id,
    e.case_id AS target_id,
    'case'::text AS target_type,
    'evidence:read'::text AS action,
    e.purpose AS reason
   FROM private.evidence_access_log e
UNION ALL
 SELECT 'decision_proposed:'::text || d.id::text AS id,
    d.proposed_at AS occurred_at,
    d.proposed_by AS actor_id,
    d.case_id AS target_id,
    'case'::text AS target_type,
    'decision:proposed'::text AS action,
    NULL::text AS reason
   FROM private.decisions d
UNION ALL
 SELECT 'decision_approved:'::text || d.id::text AS id,
    d.approved_at AS occurred_at,
    d.approved_by AS actor_id,
    d.case_id AS target_id,
    'case'::text AS target_type,
    'decision:approved'::text AS action,
    NULL::text AS reason
   FROM private.decisions d
  WHERE d.approved_at IS NOT NULL
UNION ALL
 SELECT 'decision_withdrawn:'::text || d.id::text AS id,
    d.withdrawn_at AS occurred_at,
    d.withdrawn_by AS actor_id,
    d.case_id AS target_id,
    'case'::text AS target_type,
    'decision:withdrawn'::text AS action,
    d.withdrawal_reason AS reason
   FROM private.decisions d
  WHERE d.withdrawn_at IS NOT NULL
UNION ALL
 SELECT 'organisation:'::text || o.id::text AS id,
    o.created_at AS occurred_at,
    o.actor_id,
    o.organisation_id AS target_id,
    'organisation'::text AS target_type,
    'organisation:'::text || o.action AS action,
    o.reason
   FROM private.organisation_events o
UNION ALL
 SELECT 'partner:'::text || p.id::text AS id,
    p.created_at AS occurred_at,
    p.actor_id,
    p.partner_id AS target_id,
    'partner'::text AS target_type,
    'partner:'::text || p.action AS action,
    p.reason
   FROM private.partner_events p
UNION ALL
 SELECT 'queue:'::text || q.id::text AS id,
    q.created_at AS occurred_at,
    q.actor_id,
    COALESCE(q.post_id, q.report_id) AS target_id,
        CASE
            WHEN q.post_id IS NULL THEN 'report'::text
            ELSE 'post'::text
        END AS target_type,
    'queue:'::text || q.event AS action,
    q.reason
   FROM private.queue_claim_events q
UNION ALL
 SELECT 'staff_granted:'::text || r.id::text AS id,
    r.granted_at AS occurred_at,
    r.granted_by AS actor_id,
    r.user_id AS target_id,
    'account'::text AS target_type,
    'staff:granted'::text AS action,
    NULL::text AS reason
   FROM private.staff_roles r
UNION ALL
 SELECT 'staff_revoked:'::text || r.id::text AS id,
    r.revoked_at AS occurred_at,
    r.revoked_by AS actor_id,
    r.user_id AS target_id,
    'account'::text AS target_type,
    'staff:revoked'::text AS action,
    NULL::text AS reason
   FROM private.staff_roles r
  WHERE r.revoked_at IS NOT NULL
UNION ALL
 SELECT 'governance_note:'::text || g.id::text AS id,
    g.created_at AS occurred_at,
    g.actor_id,
    d.case_id AS target_id,
    'case'::text AS target_type,
    'governance:'::text || g.action AS action,
    g.reason
   FROM private.frontend_governance_events g
     JOIN private.decisions d ON d.id = g.decision_id
UNION ALL
 SELECT 'feature_flag:'::text || f.id::text AS id,
    f.created_at AS occurred_at,
    f.actor_id,
    f.flag_id AS target_id,
    'feature_flag'::text AS target_type,
    'feature_flag:updated'::text AS action,
    f.reason
   FROM private.frontend_feature_flag_events f
UNION ALL
 SELECT 'evidence_claim:'::text || h.id::text AS id,
    h.created_at AS occurred_at,
    h.actor_id,
    h.case_id AS target_id,
    'case'::text AS target_type,
    'queue:'::text || h.event AS action,
    h.reason
   FROM private.frontend_evidence_claim_events h
UNION ALL
 SELECT 'report_action:'::text || r.id::text AS id,
    r.created_at AS occurred_at,
    r.actor_id,
    r.report_id AS target_id,
    'report'::text AS target_type,
    ('report:'::text || r.action) ||
        CASE r.status
            WHEN 'proposed'::text THEN '_proposed'::text
            WHEN 'emergency_applied'::text THEN '_emergency'::text
            ELSE ''::text
        END AS action,
    r.reason
   FROM private.frontend_report_action_receipts r
UNION ALL
 SELECT 'appeal_submit:'::text || a.id AS id,
    a.created_at AS occurred_at,
    a.appellant_id AS actor_id,
    a.appellant_id AS target_id,
    'account'::text AS target_type,
    'appeal:submitted'::text AS action,
    NULL::text AS reason
   FROM private.frontend_appeals a
UNION ALL
 SELECT 'appeal_review:'::text || a.id AS id,
    a.resolved_at AS occurred_at,
    a.reviewer_id AS actor_id,
    a.appellant_id AS target_id,
    'account'::text AS target_type,
    'appeal:'::text || a.status AS action,
    a.reviewer_rationale AS reason
   FROM private.frontend_appeals a
  WHERE a.resolved_at IS NOT NULL
UNION ALL
 SELECT 'restriction_lift:'::text || x.id AS id,
    x.lifted_at AS occurred_at,
    x.lifted_by AS actor_id,
    x.account_id AS target_id,
    'account'::text AS target_type,
    'restriction:lifted'::text AS action,
    x.lift_reason AS reason
   FROM private.frontend_account_restrictions x
  WHERE x.lifted_at IS NOT NULL
UNION ALL
 SELECT 'privacy_request:'::text || e.id AS id,
    e.occurred_at,
    e.actor_id,
    e.request_id AS target_id,
    'case'::text AS target_type,
    'privacy:'::text || e.action AS action,
    NULL::text AS reason
   FROM private.privacy_request_events e
UNION ALL
 SELECT 'staff_role_proposal:'::text || x.id AS id,
    x.created_at AS occurred_at,
    x.proposer_id AS actor_id,
    x.target_id,
    'account'::text AS target_type,
    'staff_role:proposed'::text AS action,
    x.reason
   FROM private.frontend_staff_role_changes x
  WHERE NOT x.direct_removal
UNION ALL
 SELECT 'staff_role_outcome:'::text || x.id AS id,
    x.decided_at AS occurred_at,
    x.reviewer_id AS actor_id,
    x.target_id,
    'account'::text AS target_type,
    'staff_role:'::text || x.status AS action,
    COALESCE(x.note, x.reason) AS reason
   FROM private.frontend_staff_role_changes x
  WHERE x.status <> 'proposed'::text;
alter view private.frontend_staff_nonpayment_audit_events owner to postgres;
revoke all on private.frontend_staff_nonpayment_audit_events from public;

commit;
