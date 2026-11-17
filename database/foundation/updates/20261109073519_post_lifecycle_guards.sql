-- Post lifecycle guards. No member-facing rule changes and no new deletion;
-- these protections come before any change to the deletion rules.
--
-- 1. An open staff content hold (frontend_content_holds) now blocks every
--    deletion path: the lifecycle job skips the post and does not warn about a
--    deletion it will not make, the owner cannot mark it sold, archive it or
--    delete it (the existing PT423 staff_visibility_hold refusal), any other
--    delete of the post row is refused by a trigger, and the media the post
--    showed when it was hidden are kept from media cleanup until the hold is
--    released. When the last hold is released, an idle post's deletion clock
--    counts from the release, not from before the hold.
-- 2. The deletion clock of an expired, sold or archived post is a stable
--    value: posts.ended_at (when the post's public run ended) and
--    posts.deletes_at (when the lifecycle job may delete it, today ended_at +
--    30 days). Only publication or a new submission for review clears them.
--    The edit flow passes an ended post through 'paused' and back inside one
--    transaction, which reset status_changed_at; that no longer moves the
--    deletion date or re-sends the post_expired notice and its reminders.
-- 3. Free-event submissions are kept in private.event_submissions, so the
--    10 per rolling 30 days limit no longer depends on the event rows still
--    existing. Owner decision DEC-32 is unchanged: an owner deleting their
--    own event returns its place; deletion by the lifecycle job does not.
--    The five-active limit still counts current rows.
begin;
set local lock_timeout='5s';

-- Preconditions: the bodies replaced below are the reviewed ones.
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.run_post_lifecycle(integer)'::regprocedure)<>'2c6334796e1457438f05173114bd24c0' then raise exception 'post lifecycle job drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.set_post_state(uuid,integer,text)'::regprocedure)<>'a18e906729c482586fe4ec5b9364bea3' then raise exception 'post state command drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.delete_post(uuid,integer)'::regprocedure)<>'045ed31196ed9794a56058737c5aa855' then raise exception 'post deletion command drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.submit_post(uuid,integer)'::regprocedure)<>'030410f90f45725038d967b88dc6505d' then raise exception 'post submission command drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.frontend_post_approval_digest(uuid)'::regprocedure)<>'e3aff294da953960165bc6e1169cc697' then raise exception 'approval digest drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.frontend_post_structural_digest(uuid)'::regprocedure)<>'750262fdf938cba4d8c7ef23e45d3969' then raise exception 'structural digest drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.frontend_privacy_export_data(uuid)'::regprocedure)<>'0062c911d60b8365829067b4300900d7' then raise exception 'privacy export registry drift';end if;
end$$;

-- Every table lock this update needs, taken first and in one fixed order,
-- without waiting: if any of these tables is busy the update stops at once,
-- holding nothing, and can simply be run again. Holding them blocks writes to
-- posts, holds, media records and Auth users (including sign-in bookkeeping)
-- only for the update's own run time.
lock table private.posts in access exclusive mode nowait;
lock table private.frontend_content_holds,private.media_objects,auth.users in share row exclusive mode nowait;

-- 2. Stable deletion clock.
-- Every change to private.posts' definition comes before the backfill: its
-- deferred constraint triggers would otherwise block later ALTER TABLE.
alter table private.posts add column ended_at timestamptz, add column deletes_at timestamptz;
create index posts_deletion_due_idx on private.posts(deletes_at) where deletes_at is not null;

create function internal.post_lifecycle_clock()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  -- Publication or a new submission for review starts a new run. Ending a run
  -- starts the deletion clock once; passing through paused, draft or rejected
  -- (the edit flow does this inside one transaction) keeps it.
  if new.status in('live','pending_moderation') then
    new.ended_at:=null;new.deletes_at:=null;
  elsif new.status in('expired','sold','archived') then
    new.ended_at:=coalesce(new.ended_at,statement_timestamp());
    new.deletes_at:=coalesce(new.deletes_at,new.ended_at+interval '30 days');
  end if;
  return new;
end$$;
revoke all on function internal.post_lifecycle_clock() from public,anon,authenticated,service_role;
create trigger post_lifecycle_clock before insert or update of status on private.posts
  for each row execute function internal.post_lifecycle_clock();

-- 1. Staff content holds block deletion.
create function internal.guard_frontend_content_hold_delete()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if exists(select 1 from private.frontend_content_holds h where h.post_id=old.id and h.released_at is null) then
    raise exception 'staff visibility hold requires independent release' using errcode='PT423',detail='staff_visibility_hold';
  end if;
  return old;
end$$;
revoke all on function internal.guard_frontend_content_hold_delete() from public,anon,authenticated,service_role;
create trigger guard_frontend_content_hold_delete before delete on private.posts
  for each row execute function internal.guard_frontend_content_hold_delete();

update private.posts set ended_at=status_changed_at,deletes_at=status_changed_at+interval '30 days'
  where status in('expired','sold','archived');
set constraints all immediate;
alter table private.posts add constraint posts_ended_deletion_clock
  check(status not in('expired','sold','archived') or (ended_at is not null and deletes_at is not null));

-- Approval snapshots compare content only; lifecycle timestamps stay out.
create or replace function internal.frontend_post_approval_digest(p_id uuid)
returns text language sql stable set search_path=pg_catalog as $$
 select encode(sha256(convert_to(jsonb_build_object(
   'post',to_jsonb(p)-array['status','status_reason','revision','published_at','visible_until','submitted_at','content_updated_at','status_changed_at','ended_at','deletes_at'],
   'listing',(select to_jsonb(d) from private.listing_details d where d.post_id=p.id),
   'business',(select to_jsonb(d) from private.business_details d where d.post_id=p.id),
   'event',(select to_jsonb(d) from private.event_details d where d.post_id=p.id),
   'contacts',(select to_jsonb(c) from private.post_contacts c where c.post_id=p.id),
   'media',coalesce((select jsonb_agg(to_jsonb(m) order by purpose,position) from private.post_media m where m.post_id=p.id),'[]'::jsonb),
   'presentation',(select to_jsonb(d) from private.post_presentations d where d.post_id=p.id),
   'presentation_media',coalesce((select jsonb_agg(to_jsonb(m) order by purpose,position) from private.post_presentation_media m where m.post_id=p.id),'[]'::jsonb)
 )::text,'UTF8')),'hex') from private.posts p where p.id=p_id;
$$;
revoke all on function internal.frontend_post_approval_digest(uuid) from public,anon,authenticated,service_role;

create or replace function internal.frontend_post_structural_digest(p_id uuid)
returns text language sql stable set search_path=pg_catalog as $$
 select encode(sha256(convert_to(jsonb_build_object(
   'post',to_jsonb(p)-array['status','status_reason','revision','published_at','visible_until','submitted_at','content_updated_at','status_changed_at','ended_at','deletes_at'],
   'listing',(select to_jsonb(d)-array['price_mode','price_cents','price_negotiable'] from private.listing_details d where d.post_id=p.id),
   'business',(select to_jsonb(d) from private.business_details d where d.post_id=p.id),
   'event',(select to_jsonb(d) from private.event_details d where d.post_id=p.id),
   'contacts',(select to_jsonb(c) from private.post_contacts c where c.post_id=p.id),
   'media',coalesce((select jsonb_agg(to_jsonb(m) order by purpose,position) from private.post_media m where m.post_id=p.id),'[]'::jsonb),
   'presentation',(select jsonb_set(to_jsonb(d),'{data,source_attributes}',coalesce(d.data->'source_attributes','{}'::jsonb)-array['monthly_rent_zar','salary_min','salary_max']) from private.post_presentations d where d.post_id=p.id),
   'presentation_media',coalesce((select jsonb_agg(to_jsonb(m) order by purpose,position) from private.post_presentation_media m where m.post_id=p.id),'[]'::jsonb)
 )::text,'UTF8')),'hex') from private.posts p where p.id=p_id;
$$;
revoke all on function internal.frontend_post_structural_digest(uuid) from public,anon,authenticated,service_role;

-- 1. (continued) The media a post showed when it was hidden stay referenced, so
-- internal.media_object_in_use() keeps media cleanup away from them, until
-- that hold is released.
create table private.frontend_content_hold_media(
  hold_id uuid not null references private.frontend_content_holds(id) on delete cascade,
  object_id uuid not null references private.media_objects(id) on delete restrict,
  primary key(hold_id,object_id)
);
create index frontend_content_hold_media_object_idx on private.frontend_content_hold_media(object_id);
alter table private.frontend_content_hold_media enable row level security;
revoke all on private.frontend_content_hold_media from public,anon,authenticated,service_role;

create function internal.snapshot_frontend_content_hold_media()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if new.post_id is not null and new.released_at is null then
    insert into private.frontend_content_hold_media(hold_id,object_id)
      select new.id,m.object_id from private.post_media m where m.post_id=new.post_id
      union
      select new.id,m.object_id from private.post_presentation_media m where m.post_id=new.post_id
      on conflict do nothing;
  end if;
  return null;
end$$;
revoke all on function internal.snapshot_frontend_content_hold_media() from public,anon,authenticated,service_role;
create trigger snapshot_frontend_content_hold_media after insert on private.frontend_content_holds
  for each row execute function internal.snapshot_frontend_content_hold_media();

create function internal.release_frontend_content_hold_media()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if old.released_at is null and new.released_at is not null then
    delete from private.frontend_content_hold_media where hold_id=new.id;
  end if;
  return null;
end$$;
revoke all on function internal.release_frontend_content_hold_media() from public,anon,authenticated,service_role;
create trigger release_frontend_content_hold_media after update of released_at on private.frontend_content_holds
  for each row execute function internal.release_frontend_content_hold_media();

insert into private.frontend_content_hold_media(hold_id,object_id)
  select h.id,m.object_id from private.frontend_content_holds h join private.post_media m on m.post_id=h.post_id
    where h.released_at is null
  union
  select h.id,m.object_id from private.frontend_content_holds h join private.post_presentation_media m on m.post_id=h.post_id
    where h.released_at is null
  on conflict do nothing;

-- 3. Kept free-event submissions.
create table private.event_submissions(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null,
  submitted_at timestamptz not null default statement_timestamp(),
  released_at timestamptz,
  release_reason text check(release_reason='owner_deleted'),
  check((released_at is null)=(release_reason is null))
);
create index event_submissions_owner_idx on private.event_submissions(owner_id,submitted_at);
create index event_submissions_post_idx on private.event_submissions(post_id) where released_at is null;
create index event_submissions_age_idx on private.event_submissions(submitted_at);
alter table private.event_submissions enable row level security;
revoke all on private.event_submissions from public,anon,authenticated,service_role;

create function internal.event_submission_guard()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' then
    -- The only change: an owner's deletion returns the place, once.
    if old.released_at is null and new.released_at is not null
      and (new.id,new.owner_id,new.post_id,new.submitted_at) is not distinct from (old.id,old.owner_id,old.post_id,old.submitted_at) then
      return new;
    end if;
  elsif old.submitted_at<=clock_timestamp()-interval '30 days'
    or not exists(select 1 from auth.users u where u.id=old.owner_id) then
    return old; -- outside every rolling window, or removed with its erased account
  end if;
  raise exception 'event submissions are append-only' using errcode='23514';
end$$;
revoke all on function internal.event_submission_guard() from public,anon,authenticated,service_role;
create trigger event_submission_guard before update or delete on private.event_submissions
  for each row execute function internal.event_submission_guard();

-- Each original event's latest submission is enough: the limit counts
-- distinct events submitted in the window, and the window only moves forward.
insert into private.event_submissions(owner_id,post_id,submitted_at)
  select p.owner_id,p.id,p.submitted_at from private.posts p
  where p.kind='event' and p.edit_of is null and p.submitted_at>statement_timestamp()-interval '31 days';

-- The kept event submissions are personal data: they join the privacy export.
create or replace function internal.frontend_privacy_export_data(p_subject uuid)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare entry record;items jsonb;row_count integer;result jsonb:='{}';size_so_far bigint:=0;
begin
  for entry in select * from (values
    ('profile',$q$select account_id,display_name,bio,legal_first_name,legal_last_name,legal_name_locked_at,created_at,updated_at from private.profiles where account_id=$1$q$),
    ('account',$q$select id,email,email_confirmed_at,phone,phone_confirmed_at,created_at,last_sign_in_at from auth.users where id=$1 and deleted_at is null$q$),
    ('listing_drafts',$q$select category_key,price_mode,price_cents,price_negotiable,revision,expires_at from private.listing_price_drafts where owner_id=$1$q$),
    ('posts',$q$select p.id,p.kind,p.area,p.category_key,p.activity_key,p.title,p.description,p.province_id,p.city_id,p.locality_label,
      p.status,p.status_reason,p.created_at,p.submitted_at,p.published_at,p.visible_until,p.edit_of,
      l.price_mode,l.price_cents,l.price_negotiable,l.attributes,b.business_type,e.starts_at,e.ends_at,e.timezone,
      s.slug,d.data presentation,d.contacts contact_details,c.channels
      from private.posts p left join private.listing_details l on l.post_id=p.id left join private.business_details b on b.post_id=p.id
      left join private.event_details e on e.post_id=p.id left join private.post_slugs s on s.post_id=p.id
      left join private.post_presentations d on d.post_id=p.id left join private.post_contacts c on c.post_id=p.id
      where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('post_reviews',$q$select m.post_id,m.edit_id,m.decision,m.reason,m.decided_at,m.price_only
      from private.moderation_log m join private.posts p on p.id=m.post_id where p.owner_id=$1 order by m.decided_at,m.id$q$),
    ('media_metadata',$q$select id,kind,size_bytes,mime,width,height,state,created_at,deleted_at from private.media_objects where owner_id=$1 order by created_at,id$q$),
    ('payments',$q$select id,product_kind,target_post_id,amount_cents,currency,status,fulfillment_status,merchant_reference,provider,created_at,completed_at
      from private.payments where owner_id=$1 order by created_at,id$q$),
    ('invoices',$q$select i.id,i.payment_id,i.invoice_number,i.amount_ex_vat_cents,i.vat_cents,i.total_cents,i.description,i.issued_at
      from private.invoices i join private.payments p on p.id=i.payment_id where p.owner_id=$1 order by i.issued_at,i.id$q$),
    ('entitlements',$q$select id,source,area,slot_capacity,activations_per_period,activation_period_days,max_photos,max_videos,starts_at,ends_at,status,revoked_reason
      from private.entitlements where owner_id=$1 order by created_at,id$q$),
    ('post_activations',$q$select post_id,entitlement_id,activated_at,released_at,release_reason
      from private.post_activations where owner_id=$1 order by activated_at,id$q$),
    ('event_submissions',$q$select post_id,submitted_at,released_at,release_reason
      from private.event_submissions where owner_id=$1 order by submitted_at,id$q$),
    ('introductory_trials',$q$select post_id,trial_entitlement_id,claimed_at,converted_at
      from private.post_trial_claims where owner_id=$1 order by claimed_at,post_id$q$),
    ('posting_terms',$q$select version,document_hash,accepted_at from private.posting_terms_acceptances where owner_id=$1 order by accepted_at,version$q$),
    ('verification_cases',$q$select id,kind,status,created_at from private.evidence_cases where subject_id=$1 order by created_at,id$q$),
    ('verification_reviews',$q$select r.case_id,r.reason,r.decision,r.created_at from private.verification_return_requests r join private.evidence_cases c on c.id=r.case_id
      where c.subject_id=$1 order by r.created_at,r.id$q$),
    ('evidence_metadata',$q$select id,case_id,purpose,state,size_bytes,created_at,retain_until,deleted_at
      from private.evidence_artifacts where owner_id=$1 order by created_at,id$q$),
    ('phone_verification',$q$select phone,verified_at,contact_changed_at,revoked_at from private.verification_phone_proofs where owner_id=$1 order by verified_at,id$q$),
    ('locality_verification',$q$select province_id,city_id,assurance,confirmed_at from private.verification_localities where owner_id=$1$q$),
    ('enquiries_sent',$q$select id,post_id,message,created_at from private.enquiries where sender_account_id=$1 order by created_at,id$q$),
    ('enquiries_received',$q$select id,post_id,message,status,created_at from private.enquiries where owner_id=$1 order by created_at,id$q$),
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
end$$;
revoke all on function internal.frontend_privacy_export_data(uuid) from public,anon,authenticated,service_role;

-- Server job, run every minute by the operations worker. Nothing is kept
-- indefinitely, except while a legal hold or a staff content hold is open.
create or replace function internal.run_post_lifecycle(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare n_expired integer := 0; n_notices integer := 0; n_deleted integer := 0;
  r record; post private.posts; changed integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  -- Candidates are unlocked. Take the shared hold/closure subject guard before
  -- locking a post, then re-evaluate all mutable eligibility under those locks.
  for r in
    select p.id,p.owner_id from private.posts p
    where p.status='live' and p.visible_until<=clock_timestamp()
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
    order by p.visible_until,p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.status='live'
      and p.visible_until<=clock_timestamp() for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null) then continue; end if;
    update private.posts set status='expired',status_reason='Visibility period ended',revision=revision+1 where id=post.id;
    update private.post_search_documents set is_visible=false where post_id=post.id;
    update private.post_activations set released_at=clock_timestamp(),release_reason='expired'
      where post_id=post.id and released_at is null;
    n_expired:=n_expired+1;
  end loop;
  -- At most p_limit new notices per invocation; old dedupe rows do not starve
  -- later notices. Lock/recheck each post so a concurrent renewal invalidates
  -- the captured revision before its stale reminder can be queued. Expiry
  -- notices key on ended_at, which edits do not move. A held post is not
  -- warned about a deletion that will not happen; an idle post's clock counts
  -- from the release of its last staff hold.
  for r in
    select n.* from (
      select 'post_expired'::text as kind,p.id,p.owner_id,p.revision,p.ended_at as due_at,
        'post_expired:'||p.id||':'||floor(extract(epoch from p.ended_at))::bigint as dedupe_key
      from private.posts p where p.status='expired'
      union all
      select 'post_expiry_reminder',p.id,p.owner_id,p.revision,p.ended_at+make_interval(days=>d.day),
        'post_expiry_reminder:'||p.id||':'||d.day||':'||floor(extract(epoch from p.ended_at))::bigint
      from private.posts p cross join (values(7),(21)) d(day)
      where p.status='expired' and p.ended_at<=clock_timestamp()-make_interval(days=>d.day)
      union all
      select 'draft_deletion_warning',p.id,p.owner_id,p.revision,i.idle_since+interval '45 days',
        'draft_deletion_warning:'||p.id||':'||floor(extract(epoch from i.idle_since))::bigint
      from private.posts p cross join lateral (select greatest(p.content_updated_at,p.status_changed_at,
        (select max(h.released_at) from private.frontend_content_holds h where h.post_id=p.id)) as idle_since) i
      where p.status in('draft','rejected','paused') and i.idle_since<=clock_timestamp()-interval '45 days'
    ) n where not exists(select 1 from private.outbox_events o where o.dedupe_key=n.dedupe_key)
      and not exists(select 1 from private.legal_holds h where h.subject_id=n.owner_id and h.released_at is null)
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=n.id and h.released_at is null)
    order by n.due_at,n.id,n.kind,n.dedupe_key limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.revision=r.revision for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.frontend_content_holds h where h.post_id=r.id and h.released_at is null) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values(r.kind,r.id,r.owner_id,r.dedupe_key)
      on conflict(dedupe_key) do nothing;
    get diagnostics changed=row_count; n_notices:=n_notices+changed;
  end loop;
  for r in
    select p.id,p.owner_id from private.posts p
    where ((p.status in('expired','sold','archived') and p.deletes_at<=clock_timestamp())
      or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at,
        (select max(h.released_at) from private.frontend_content_holds h where h.post_id=p.id))<=clock_timestamp()-interval '60 days'))
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
      and not exists(select 1 from private.posts e where e.edit_of=p.id and (e.status='pending_moderation' or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days'))
    order by p.status_changed_at,p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and
      ((p.status in('expired','sold','archived') and p.deletes_at<=clock_timestamp())
       or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at,
         (select max(h.released_at) from private.frontend_content_holds h where h.post_id=p.id))<=clock_timestamp()-interval '60 days'))
      for update of p skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.frontend_content_holds h where h.post_id=post.id and h.released_at is null)
      or exists(select 1 from private.posts e where e.edit_of=post.id and (e.status='pending_moderation' or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days')) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('post_deleted',post.id,post.owner_id,'post_deleted:'||post.id) on conflict(dedupe_key) do nothing;
    delete from private.posts where id=post.id;
    n_deleted:=n_deleted+1;
  end loop;
  -- Free-event submissions older than every rolling 30-day window.
  delete from private.event_submissions s where s.id in(select x.id from private.event_submissions x
    where x.submitted_at<=clock_timestamp()-interval '31 days' order by x.submitted_at limit p_limit);
  return jsonb_build_object('expired',n_expired,'notices',n_notices,'deleted',n_deleted);
end;
$$;
revoke all on function internal.run_post_lifecycle(integer) from public,anon,authenticated,service_role;
grant execute on function internal.run_post_lifecycle(integer) to service_role;

create or replace function internal.set_post_state(p_post_id uuid, p_expected_revision integer, p_action text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts; next_status text; rev integer;
begin
  perform internal.assert_post_revision(p_expected_revision);
  next_status := case p_action when 'pause' then 'paused' when 'sold' then 'sold' when 'archive' then 'archived' end;
  if next_status is null then raise exception 'unknown action' using errcode = '22023'; end if;
  -- Match hold placement ordering: account subject before post rows.
  perform internal.lock_evidence_subject(actor);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  -- While a staff hold is open the owner cannot change the post's state here:
  -- sold or archived would start its deletion clock.
  if exists (select 1 from private.frontend_content_holds h where h.post_id = post.id and h.released_at is null) then
    raise exception 'staff visibility hold requires independent release' using errcode = 'PT423', detail = 'staff_visibility_hold';
  end if;
  if post.status not in ('live', 'paused') or (p_action = 'sold' and post.kind <> 'listing')
    or (p_action = 'pause' and post.status <> 'live') then
    raise exception 'action not available for this post' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if next_status in ('sold', 'archived') then
    delete from private.posts where edit_of = post.id; -- an edit of a finished post is moot
  end if;
  update private.posts set status = next_status, revision = revision + 1 where id = post.id returning revision into rev;
  update private.post_search_documents set is_visible = false where post_id = post.id;
  update private.post_activations set released_at = statement_timestamp(),
    release_reason = case when p_action = 'sold' then 'sold' else 'owner' end
  where post_id = post.id and released_at is null;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', next_status, 'revision', rev);
end;
$$;
revoke all on function internal.set_post_state(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.set_post_state(uuid,integer,text) to authenticated;

create or replace function internal.delete_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts;
begin
  perform internal.assert_post_revision(p_expected_revision);
  -- Match hold placement/closure ordering: account subject before post rows.
  perform internal.lock_evidence_subject(actor);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found or post.edit_of is not null then raise exception 'post not found' using errcode = '22023'; end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if exists (select 1 from private.legal_holds h where h.subject_id = actor and h.released_at is null) then
    raise exception 'posts cannot be deleted during a legal hold' using errcode = 'PT409';
  end if;
  if exists (select 1 from private.frontend_content_holds h where h.post_id = post.id and h.released_at is null) then
    raise exception 'staff visibility hold requires independent release' using errcode = 'PT423', detail = 'staff_visibility_hold';
  end if;
  -- Owner decision DEC-32: deleting one's own free event returns its place in
  -- the rolling submission limit.
  update private.event_submissions set released_at = statement_timestamp(), release_reason = 'owner_deleted'
    where post_id = post.id and owner_id = actor and released_at is null;
  delete from private.posts where id = post.id; -- with its edit copy, links and queue claim
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'deleted');
end;
$$;
revoke all on function internal.delete_post(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.delete_post(uuid,integer) to authenticated;

create or replace function internal.submit_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  photos integer;
  videos integer;
  photo_limit integer;
  video_limit integer;
  rev integer;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'this post cannot be submitted now' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  perform internal.price_draft_actor();
  perform internal.assert_post_contacts_ready(post.id,false);
  perform internal.assert_posting_verification_ready(post.id,false);
  if post.title is null then
    raise exception 'title length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 2 else 5 end,
    'maxLength',case when post.kind='event' then 120 else 100 end),to_jsonb(post.title));
  if post.kind in ('listing','event') and post.description is null then
    raise exception 'description length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 0 else 20 end,
    'maxLength',case when post.kind='business' then 3000 else 5000 end),to_jsonb(coalesce(post.description,'')));
  if post.province_id is null or (post.city_id is null and post.locality_label is null) then
    raise exception 'province and city or locality required' using errcode = '22023';
  end if;
  if post.kind='listing' then
    if not exists(select 1 from private.listing_details d where d.post_id=post.id and d.price_mode is not null) then
      raise exception 'choose an explicit listing price' using errcode='22023';
    end if;
    perform internal.validate_listing_attributes(post.category_key,d.attributes,true)
      from private.listing_details d where d.post_id=post.id;
  end if;
  select count(distinct pm.object_id) into photos from private.post_media pm
    where pm.post_id = post.id and pm.purpose in ('cover', 'gallery');
  select count(distinct pm.object_id) into videos from private.post_media pm where pm.post_id=post.id and pm.purpose='video';
  if ((post.kind='listing' and post.category_key<>'jobs_services') or (post.kind='business' and post.area='tourism_events')) and photos = 0 then
    raise exception 'at least one photo is required' using errcode = '22023';
  end if;
  if post.kind='event' and photos+videos=0 then raise exception 'at least one photo or video required' using errcode='22023'; end if;
  if photos > 0 and not exists (select 1 from private.post_media pm where pm.post_id = post.id and pm.purpose = 'cover') then
    raise exception 'choose a cover photo' using errcode = '22023';
  end if;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = post.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = '22023';
  end if;
  if post.edit_of is not null then
    -- A live edit uses the live post's funding: no new activation or fair use.
    if not exists (select 1 from private.posts o where o.id = post.edit_of and o.status = 'live') then
      raise exception 'the live post is no longer published' using errcode = 'PT409';
    end if;
    if internal.edit_is_price_only(post.edit_of, post.id) then
      if internal.recent_price_change(post.edit_of) then
        raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
      end if;
    elsif internal.approved_edit_count(post.edit_of) >= internal.edit_allowance(post.edit_of) then
      raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
    end if;
    select f.max_photos, f.max_videos into photo_limit, video_limit
      from internal.post_funding(post.edit_of) f where f.funded_until > statement_timestamp();
    if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode = '22023';
    end if;
  elsif post.kind = 'event' then
    -- Free events: fair use of 5 active (pending or live) and 10 submissions
    -- per 30 days. The 10 are counted from the kept submission ledger, so an
    -- event removed by the lifecycle job keeps its place; an owner deleting
    -- their own event returns it (internal.delete_post).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 909));
    perform internal.price_draft_actor(); -- fresh authority before quota or duplicate errors
    if (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.status in ('pending_moderation', 'live') and p.id <> post.id) >= 5
      or (select count(distinct s.post_id) from private.event_submissions s where s.owner_id = actor
          and s.released_at is null and s.submitted_at > statement_timestamp() - interval '30 days' and s.post_id <> post.id) >= 10 then
      raise exception 'event fair-use limit reached' using errcode = 'PT429';
    end if;
  else
    perform internal.activate_post(post.id);
    select e.max_photos,e.max_videos into photo_limit,video_limit
      from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
      where a.post_id=post.id and a.released_at is null;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode='22023';
    end if;
  end if;
  if post.kind='event' then
    perform internal.assert_event_duplicate_absent(post.id,false);
    if post.edit_of is not null and not exists(
      select 1 from internal.post_funding(post.edit_of) f where f.funded_until>clock_timestamp()) then
      raise exception 'funding or event window has ended' using errcode='PT409';
    end if;
  end if;
  update private.posts set status = 'pending_moderation', submitted_at = statement_timestamp(),
    status_reason = null, revision = revision + 1
  where id = post.id returning revision into rev;
  if post.kind = 'event' and post.edit_of is null then
    insert into private.event_submissions(owner_id, post_id, submitted_at) values (actor, post.id, statement_timestamp());
  end if;
  perform internal.assert_post_contacts_ready(post.id,false);
  perform internal.assert_posting_verification_ready(post.id,false);
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'pending_moderation', 'revision', rev);
end;
$$;
revoke all on function internal.submit_post(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.submit_post(uuid,integer) to authenticated;
commit;
