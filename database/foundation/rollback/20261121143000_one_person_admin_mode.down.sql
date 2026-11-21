-- Reviewed rollback for updates/20261121143000_one_person_admin_mode.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. No website release depends on
-- the update (it changes no API command), so no deploy is needed first.
-- It puts back the staff audit view and the five functions as they were
-- (house slots 1 to 15, approval by a second ID-verified administrator only,
-- every own post a conflict), drops internal.single_administrator and the
-- two new columns. It refuses while any house slot event is marked
-- self_granted or any decision self_approved: those records are kept, so a
-- rollback after the first one needs a forward fix instead.
begin;
set local lock_timeout='5s';

do $$begin
  if to_regprocedure('internal.single_administrator(uuid)') is null or not exists(select 1 from pg_attribute a
      where a.attrelid='private.moderation_log'::regclass and a.attname='self_approved' and not a.attisdropped) then
    raise exception 'rollback precondition: the one-person admin mode update is not applied' using errcode='55000';
  end if;
  if exists(select 1 from private.house_slot_events where self_granted)
    or exists(select 1 from private.moderation_log where self_approved) then
    raise exception 'rollback precondition: self-granted or self-approved records exist; keep them and fix forward' using errcode='55000';
  end if;
end$$;

-- The staff audit view as it was before the update.
create or replace view private.frontend_staff_nonpayment_audit_events with (security_invoker=true) as
 SELECT 'moderation:'::text || m.id::text AS id,
    m.decided_at AS occurred_at,
    m.staff_id AS actor_id,
    m.post_id AS target_id,
    'post'::text AS target_type,
    'post:'::text || m.decision AS action,
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

-- The five functions as they were before the update.

CREATE OR REPLACE FUNCTION internal.grant_house_slots(p_recipient_email text, p_slots integer, p_days integer, p_reason text, p_approved_by_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_recipient uuid; v_approver uuid; v_identity text; v_approver_identity text; v_ends timestamptz;
  v_held uuid[]; v_slot private.entitlements;
  v_id uuid; v_added integer:=0; v_extended integer:=0;
begin
  -- The count of slots already held is read after the staff role lock; only
  -- read committed sees a grant that committed while this one waited.
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'house slots: run this command in a read committed transaction' using errcode='55000',
      detail='house_slots_isolation';
  end if;
  if p_slots is null or p_slots<1 or p_slots>15 then
    raise exception 'house slots: choose 1 to 15 slots' using errcode='22023', detail='house_slots_count_invalid';
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
  if v_approver=v_recipient then
    raise exception 'house slots: the approver must be a different administrator account' using errcode='42501',
      detail='house_slots_self_approval';
  end if;
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
    insert into private.house_slot_events(entitlement_id, action, ends_at, approved_by, reason)
      values(v_slot.id, 'extended', v_ends, v_approver, p_reason);
    v_extended:=v_extended+1;
  end loop;
  for i in 1..(p_slots-cardinality(v_held)) loop
    insert into private.entitlements(owner_id, source, area, granted_by, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values(v_recipient, 'staff_grant', null, v_approver, 1, 4, 30, 10, 1, statement_timestamp(), v_ends, '{}')
      returning id into v_id;
    insert into private.house_slot_events(entitlement_id, action, ends_at, approved_by, reason)
      values(v_id, 'granted', v_ends, v_approver, p_reason);
    v_added:=v_added+1;
  end loop;
  return jsonb_build_object('account_id', v_recipient, 'approved_by', v_approver, 'house_slots', p_slots,
    'added', v_added, 'extended', v_extended,
    'slots', (select jsonb_agg(jsonb_build_object('id', e.id, 'ends_at', e.ends_at) order by e.ends_at, e.id)
      from private.entitlements e where e.owner_id=v_recipient and e.source='staff_grant' and e.status='active'
        and e.ends_at>statement_timestamp()
        and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)));
end;
$function$;
alter function internal.grant_house_slots(text,integer,integer,text,text) owner to postgres;
revoke all on function internal.grant_house_slots(text,integer,integer,text,text) from public;

CREATE OR REPLACE FUNCTION internal.queue_conflict(p_actor uuid, p_post_id uuid, p_report_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p_post_id is not null
    then exists(select 1 from private.posts p where p.id=p_post_id and p.owner_id=p_actor)
    else exists(select 1 from private.reports r where r.id=p_report_id and
      (r.reporter_id=p_actor or r.subject_account_id=p_actor
       or r.duplicate_owner_b=p_actor or r.duplicate_created_by=p_actor))
  end;
$function$;
alter function internal.queue_conflict(uuid,uuid,uuid) owner to postgres;
revoke all on function internal.queue_conflict(uuid,uuid,uuid) from public;

CREATE OR REPLACE FUNCTION internal.claim_queue_items(p_queue text, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      where p.status = 'pending_moderation' and p.owner_id <> actor
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
revoke all on function internal.claim_queue_items(text,integer) from public;
grant execute on function internal.claim_queue_items(text,integer) to authenticated;

CREATE OR REPLACE FUNCTION internal.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text, p_reason text, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.staff_actor('post:moderate');
  post private.posts;
  original_id uuid;
  funded_until timestamptz;
  photo_limit integer;
  video_limit integer;
  rev integer;
  merged jsonb;
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
  if post.owner_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
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
  insert into private.moderation_log (post_id, edit_id, staff_id, decision, post_revision, reason, price_only)
  values (coalesce(original_id, post.id), case when original_id is not null then post.id end, actor, p_decision,
    p_expected_revision, nullif(btrim(coalesce(p_reason, '')), ''), coalesce((merged->>'price_only')::boolean, false));
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
revoke all on function internal.moderate_post(uuid,integer,text,text,text,uuid) from public;
grant execute on function internal.moderate_post(uuid,integer,text,text,text,uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.assert_posting_verification_ready(p_post_id uuid, p_staff boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
  if (not p_staff and owner<>actor) or (p_staff and owner=actor) then
    raise exception 'caller cannot publish this post' using errcode='42501';
  end if;
  if not ready then
    raise exception 'complete identity verification before posting' using errcode='42501',
      detail='posting_verification_required';
  end if;
end;
$function$;
alter function internal.assert_posting_verification_ready(uuid,boolean) owner to postgres;
revoke all on function internal.assert_posting_verification_ready(uuid,boolean) from public;

drop function internal.single_administrator(uuid);

alter table private.moderation_log drop constraint moderation_log_self_approved_check;

alter table private.moderation_log drop column self_approved;

alter table private.house_slot_events drop constraint house_slot_events_self_granted_check;

alter table private.house_slot_events drop column self_granted;

commit;

