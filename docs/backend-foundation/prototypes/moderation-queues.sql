-- BF-08 generic staff queues. Source queue_claims covered reports, KYC steps,
-- listings, businesses, promotions, content edits and business verification.
-- In the candidate, KYC and business verification are evidence cases with
-- their own reviewed claim columns (evidence-claim-contract.md). Every other
-- source subject is a post awaiting review (new posts of every kind and live
-- edits, see publication.sql) or a user report, and uses the claim below.
--
-- A claim is a lease on one typed subject. Each acquisition rotates a random
-- nonce and increments a monotonic generation; every decision, renewal,
-- release and claim-scoped read requires the exact live tuple held by the
-- current staff actor. Leases last 15 minutes with at most 4 renewals, and one
-- person holds at most 20 (source values). Concurrent claimers receive
-- disjoint items. Nobody claims or decides an item about themselves.
-- Governors and admins can free or reassign a claim, with a reason, audited.
-- Lock order: holder guard (advisory 1201 for the person who will hold the
-- claim), live post, edit copy, report, claim row. Staff authority is
-- re-derived after the last wait of every command, so a role or session lost
-- while waiting rolls the whole command back.

insert into private.staff_capabilities (role, capability, requires_recent_mfa) values
  ('moderator', 'queue:claim', false),
  ('governor', 'queue:claim', false),
  ('governor', 'queue:reassign', true),
  ('admin', 'queue:reassign', true),
  ('moderator', 'report:resolve', true),
  ('governor', 'report:resolve', true);

-- Reports about a public post. post_id becomes null if the post is deleted;
-- the subject account (owner at report time) is kept for repeat-abuse review.
create table private.reports (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  post_id uuid references private.posts (id) on delete set null,
  subject_account_id uuid not null references auth.users (id) on delete restrict,
  category text not null
    check (category in ('scam', 'prohibited_item', 'impersonation', 'harassment', 'misleading_info')),
  severity text not null default 'standard' check (severity in ('high', 'standard')),
  description text not null check (length(description) between 10 and 2000),
  reporter_id uuid references auth.users (id) on delete set null,
  reporter_ip_hmac text not null check (reporter_ip_hmac ~ '^[A-Za-z0-9_-]{43}$'),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution_note text check (resolution_note is null or length(resolution_note) between 5 and 500),
  resolved_by uuid references auth.users (id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  check ((status = 'open') = (resolved_at is null)),
  check ((resolved_at is null) = (resolved_by is null)),
  check ((resolved_at is null) = (resolution_note is null))
);
create index reports_open_idx on private.reports (severity, created_at) where status = 'open';
create index reports_subject_idx on private.reports (subject_account_id, status);
create unique index reports_one_open_signed_in_idx on private.reports (post_id, reporter_id)
  where status = 'open' and reporter_id is not null;
create unique index reports_one_open_anonymous_idx on private.reports (post_id, reporter_ip_hmac)
  where status = 'open' and reporter_id is null;

-- One claim row per subject, kept after release so the generation never repeats.
create table private.queue_claims (
  id bigint generated always as identity primary key,
  post_id uuid unique references private.posts (id) on delete cascade,
  report_id uuid unique references private.reports (id) on delete cascade,
  claimed_by uuid references auth.users (id) on delete restrict,
  claim_generation bigint not null default 0 check (claim_generation >= 0),
  claim_nonce uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  renewals smallint not null default 0 check (renewals between 0 and 4),
  check (num_nonnulls(post_id, report_id) = 1),
  check ((claimed_by is null and claim_nonce is null and claimed_at is null and claim_expires_at is null and renewals = 0)
    or (claimed_by is not null and claim_nonce is not null and claimed_at is not null and claim_expires_at is not null
      and claim_expires_at > claimed_at and claim_generation > 0))
);
create index queue_claims_holder_idx on private.queue_claims (claimed_by, claim_expires_at) where claimed_by is not null;

-- Staff release and reassignment history. Subject ids are plain references so
-- deleting a post or report never rewrites it.
create table private.queue_claim_events (
  id bigint generated always as identity primary key,
  post_id uuid,
  report_id uuid,
  actor_id uuid not null references auth.users (id) on delete restrict,
  event text not null check (event in ('released_by_staff', 'reassigned')),
  from_staff uuid not null references auth.users (id) on delete restrict,
  to_staff uuid references auth.users (id) on delete restrict,
  claim_generation bigint not null check (claim_generation > 0),
  reason text not null check (length(reason) between 5 and 500),
  created_at timestamptz not null default statement_timestamp(),
  check (num_nonnulls(post_id, report_id) = 1),
  check ((event = 'reassigned') = (to_staff is not null))
);
create trigger queue_claim_events_append_only before update or delete on private.queue_claim_events
  for each row execute function internal.append_only_guard();
create trigger queue_claim_events_no_truncate before truncate on private.queue_claim_events
  for each statement execute function internal.append_only_guard();

alter table private.reports enable row level security;
alter table private.queue_claims enable row level security;
alter table private.queue_claim_events enable row level security;
revoke all on private.reports, private.queue_claims, private.queue_claim_events
  from public, anon, authenticated, service_role;

-- Losing staff access frees the person's claims at once.
create function internal.release_queue_claims_on_revocation()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.revoked_at is not null or not exists (select 1 from private.staff_capabilities c
      where c.role = new.role and c.capability = 'queue:claim') then
    update private.queue_claims set claimed_by = null, claim_nonce = null, claimed_at = null,
      claim_expires_at = null, renewals = 0
    where claimed_by = new.user_id;
  end if;
  return null;
end;
$$;
revoke all on function internal.release_queue_claims_on_revocation() from public, anon, authenticated, service_role;
create trigger staff_roles_release_queue_claims after update of revoked_at, role on private.staff_roles
  for each row execute function internal.release_queue_claims_on_revocation();

-- Nobody works an item about themselves: their own post or edit, a report they
-- filed, or a report about them.
create function internal.queue_conflict(p_actor uuid, p_post_id uuid, p_report_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select case when p_post_id is not null
    then exists (select 1 from private.posts p where p.id = p_post_id and p.owner_id = p_actor)
    else exists (select 1 from private.reports r where r.id = p_report_id
      and (r.reporter_id = p_actor or r.subject_account_id = p_actor))
  end;
$$;
revoke all on function internal.queue_conflict(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Lock an open subject in the shared order and return its typed reference.
create function internal.lock_queue_subject(p_subject text, p_id uuid, out post_id uuid, out report_id uuid)
language plpgsql security invoker set search_path = pg_catalog as $$
declare original_id uuid;
begin
  if p_subject = 'post' then
    select p.edit_of into original_id from private.posts p where p.id = p_id;
    if original_id is not null then
      perform 1 from private.posts p where p.id = original_id for update;
    end if;
    select p.id into post_id from private.posts p
      where p.id = p_id and p.status = 'pending_moderation' and p.edit_of is not distinct from original_id for update;
    if post_id is null then raise exception 'item is not awaiting review' using errcode = '22023'; end if;
  elsif p_subject = 'report' then
    select r.id into report_id from private.reports r where r.id = p_id and r.status = 'open' for update;
    if report_id is null then raise exception 'item is not awaiting review' using errcode = '22023'; end if;
  else
    raise exception 'unknown queue item' using errcode = '22023';
  end if;
end;
$$;
revoke all on function internal.lock_queue_subject(text, uuid) from public, anon, authenticated, service_role;

create function internal.lock_queue_claim(p_post_id uuid, p_report_id uuid)
returns private.queue_claims language plpgsql security invoker set search_path = pg_catalog as $$
declare c private.queue_claims;
begin
  select q.* into c from private.queue_claims q
    where (q.post_id = p_post_id or q.report_id = p_report_id) for update;
  return c;
end;
$$;
revoke all on function internal.lock_queue_claim(uuid, uuid) from public, anon, authenticated, service_role;

-- Take (or, for the current holder, rotate) the claim on a locked subject.
-- Returns null when another reviewer holds a live claim.
create function internal.take_queue_claim(p_actor uuid, p_post_id uuid, p_report_id uuid)
returns private.queue_claims language plpgsql security invoker set search_path = pg_catalog as $$
declare c private.queue_claims;
begin
  if p_post_id is not null then
    insert into private.queue_claims (post_id) values (p_post_id) on conflict (post_id) do nothing;
  else
    insert into private.queue_claims (report_id) values (p_report_id) on conflict (report_id) do nothing;
  end if;
  c := internal.lock_queue_claim(p_post_id, p_report_id);
  if c.claimed_by is not null and c.claim_expires_at > clock_timestamp() then
    if c.claimed_by <> p_actor then return null; end if;
    -- The holder may rotate the tuple; the lease and renewals stay as they are.
    update private.queue_claims set claim_generation = claim_generation + 1, claim_nonce = pg_catalog.gen_random_uuid()
    where id = c.id and claim_generation < 9223372036854775807 returning * into c;
  else
    update private.queue_claims set claimed_by = p_actor, claim_generation = claim_generation + 1,
      claim_nonce = pg_catalog.gen_random_uuid(), claimed_at = clock_timestamp(),
      claim_expires_at = clock_timestamp() + interval '15 minutes', renewals = 0
    where id = c.id and claim_generation < 9223372036854775807 returning * into c;
  end if;
  if c.id is null then raise exception 'claim generation exhausted' using errcode = 'PT409'; end if;
  return c;
end;
$$;
revoke all on function internal.take_queue_claim(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- The holder's view of a claim. Generations are canonical text (bigint precision).
create function internal.queue_claim_view(p_claim private.queue_claims)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select jsonb_build_object('subject', case when p_claim.post_id is not null then 'post' else 'report' end,
    'id', coalesce(p_claim.post_id, p_claim.report_id),
    'claim_generation', p_claim.claim_generation::text, 'claim_nonce', p_claim.claim_nonce,
    'claim_expires_at', p_claim.claim_expires_at, 'renewals_left', 4 - p_claim.renewals,
    'revision', (select p.revision from private.posts p where p.id = p_claim.post_id),
    'edit_of', (select p.edit_of from private.posts p where p.id = p_claim.post_id));
$$;
revoke all on function internal.queue_claim_view(private.queue_claims) from public, anon, authenticated, service_role;

create function internal.assert_queue_claim(p_claim private.queue_claims, p_actor uuid, p_generation text, p_nonce uuid)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if p_generation is null or p_generation !~ '^[1-9][0-9]{0,18}$' or p_nonce is null then
    raise exception 'current claim generation and nonce required' using errcode = '22023';
  end if;
  if p_claim.id is null or p_claim.claimed_by is distinct from p_actor
    or p_claim.claim_generation::text is distinct from p_generation or p_claim.claim_nonce is distinct from p_nonce
    or p_claim.claim_expires_at is null or p_claim.claim_expires_at <= clock_timestamp() then
    raise exception 'current live queue claim required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function internal.assert_queue_claim(private.queue_claims, uuid, text, uuid) from public, anon, authenticated, service_role;

-- Decisions: the caller holds the subject lock. The claim is cleared in the
-- decision's own transaction, so a failed decision keeps it.
create function internal.consume_queue_claim(p_subject text, p_id uuid, p_actor uuid, p_generation text, p_nonce uuid)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare c private.queue_claims;
begin
  c := internal.lock_queue_claim(case when p_subject = 'post' then p_id end, case when p_subject = 'report' then p_id end);
  perform internal.assert_queue_claim(c, p_actor, p_generation, p_nonce);
  update private.queue_claims set claimed_by = null, claim_nonce = null, claimed_at = null,
    claim_expires_at = null, renewals = 0
  where id = c.id;
end;
$$;
revoke all on function internal.consume_queue_claim(text, uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

-- Staff: claim the next items of a queue ('content' = posts and edits awaiting
-- review, oldest first; 'reports' = open reports, high severity first).
create function internal.claim_queue_items(p_queue text, p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
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
      where x.status = 'open' and x.reporter_id is distinct from actor and x.subject_account_id <> actor
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
$$;
revoke all on function internal.claim_queue_items(text, integer) from public, anon, authenticated, service_role;
grant execute on function internal.claim_queue_items(text, integer) to authenticated;
create function api.claim_queue_items(p_queue text, p_limit integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.claim_queue_items(p_queue, p_limit);
$$;
revoke all on function api.claim_queue_items(text, integer) from public, anon, authenticated, service_role;
grant execute on function api.claim_queue_items(text, integer) to authenticated;

-- Staff: claim one item opened from a queue list.
create function internal.claim_queue_item(p_subject text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:claim'); s record; c private.queue_claims;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 1201));
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  actor := internal.staff_actor('queue:claim'); -- authority after any lock wait
  if internal.queue_conflict(actor, s.post_id, s.report_id) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  if (select count(*) from private.queue_claims q where q.claimed_by = actor and q.claim_expires_at > clock_timestamp()
      and not (q.post_id is not distinct from s.post_id and q.report_id is not distinct from s.report_id)) >= 20 then
    raise exception 'claim limit of 20 items reached' using errcode = 'PT429';
  end if;
  c := internal.take_queue_claim(actor, s.post_id, s.report_id);
  if c.id is null then raise exception 'item claimed by another reviewer' using errcode = 'PT409'; end if;
  perform internal.staff_actor('queue:claim'); -- authority after the claim-row wait
  return internal.queue_claim_view(c);
end;
$$;
revoke all on function internal.claim_queue_item(text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.claim_queue_item(text, uuid) to authenticated;
create function api.claim_queue_item(p_subject text, p_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.claim_queue_item(p_subject, p_id);
$$;
revoke all on function api.claim_queue_item(text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.claim_queue_item(text, uuid) to authenticated;

-- Holder: extend a live claim by 15 minutes, at most 4 times.
create function internal.renew_queue_claim(p_subject text, p_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:claim'); s record; c private.queue_claims;
begin
  -- Renewals can turn an apparently expired committed claim into a live one.
  -- Serialize that capacity change with acquisition and reassignment, before
  -- taking subject/claim row locks, including when renewal later rolls back.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,1201));
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  c := internal.lock_queue_claim(s.post_id, s.report_id);
  actor := internal.staff_actor('queue:claim');
  perform internal.assert_queue_claim(c, actor, p_claim_generation, p_claim_nonce);
  if c.renewals >= 4 then
    raise exception 'renewal limit reached; claim the item again after it expires' using errcode = 'PT409';
  end if;
  update private.queue_claims set claim_expires_at = clock_timestamp() + interval '15 minutes', renewals = renewals + 1
  where id = c.id returning * into c;
  return internal.queue_claim_view(c);
end;
$$;
revoke all on function internal.renew_queue_claim(text, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.renew_queue_claim(text, uuid, text, uuid) to authenticated;
create function api.renew_queue_claim(p_subject text, p_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.renew_queue_claim(p_subject, p_id, p_claim_generation, p_claim_nonce);
$$;
revoke all on function api.renew_queue_claim(text, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.renew_queue_claim(text, uuid, text, uuid) to authenticated;

-- Holder: give an item back to the queue.
create function internal.release_queue_claim(p_subject text, p_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:claim'); s record;
begin
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  actor := internal.staff_actor('queue:claim');
  perform internal.consume_queue_claim(p_subject, p_id, actor, p_claim_generation, p_claim_nonce);
  perform internal.staff_actor('queue:claim'); -- authority after the claim-row wait
  return jsonb_build_object('subject', p_subject, 'id', p_id, 'status', 'released');
end;
$$;
revoke all on function internal.release_queue_claim(text, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.release_queue_claim(text, uuid, text, uuid) to authenticated;
create function api.release_queue_claim(p_subject text, p_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.release_queue_claim(p_subject, p_id, p_claim_generation, p_claim_nonce);
$$;
revoke all on function api.release_queue_claim(text, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.release_queue_claim(text, uuid, text, uuid) to authenticated;

-- Governor/admin: free a live claim (p_to null) or hand it to another eligible
-- reviewer, with a reason. The new holder reads the tuple from my_queue_claims.
create function internal.reassign_queue_claim(p_subject text, p_id uuid, p_to uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:reassign'); s record; c private.queue_claims; reason text; previous uuid;
begin
  reason := internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb, to_jsonb(p_reason)) #>> '{}';
  if reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode = '22023';
  end if;
  -- The new holder's guard comes first, as in claim acquisition, so the cap
  -- check below cannot race the holder's own claims or another reassignment.
  if p_to is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_to::text, 1201));
  end if;
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  c := internal.lock_queue_claim(s.post_id, s.report_id);
  actor := internal.staff_actor('queue:reassign');
  if internal.queue_conflict(actor, s.post_id, s.report_id) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  if c.id is null or c.claimed_by is null or c.claim_expires_at <= clock_timestamp() then
    raise exception 'nobody holds this item' using errcode = 'PT409';
  end if;
  previous := c.claimed_by;
  if p_to is null then
    update private.queue_claims set claimed_by = null, claim_nonce = null, claimed_at = null,
      claim_expires_at = null, renewals = 0
    where id = c.id;
  else
    if p_to = previous then raise exception 'that reviewer already holds this item' using errcode = '22023'; end if;
    if not exists (select 1 from private.staff_roles r join private.staff_capabilities k on k.role = r.role
        join private.current_account_access u on u.id = r.user_id
        where r.user_id = p_to and r.revoked_at is null and k.capability = 'queue:claim')
      or internal.queue_conflict(p_to, s.post_id, s.report_id) then
      raise exception 'choose an independent reviewer who works this queue' using errcode = '22023';
    end if;
    if (select count(*) from private.queue_claims q where q.claimed_by = p_to and q.claim_expires_at > clock_timestamp()) >= 20 then
      raise exception 'that reviewer already holds 20 items' using errcode = 'PT429';
    end if;
    update private.queue_claims set claimed_by = p_to, claim_generation = claim_generation + 1,
      claim_nonce = pg_catalog.gen_random_uuid(), claimed_at = clock_timestamp(),
      claim_expires_at = clock_timestamp() + interval '15 minutes', renewals = 0
    where id = c.id and claim_generation < 9223372036854775807 returning * into c;
    if c.id is null then raise exception 'claim generation exhausted' using errcode = 'PT409'; end if;
  end if;
  insert into private.queue_claim_events (post_id, report_id, actor_id, event, from_staff, to_staff, claim_generation, reason)
  values (s.post_id, s.report_id, actor, case when p_to is null then 'released_by_staff' else 'reassigned' end,
    previous, p_to, c.claim_generation, reason);
  return jsonb_build_object('subject', p_subject, 'id', p_id,
    'status', case when p_to is null then 'released' else 'reassigned' end, 'claim_generation', c.claim_generation::text);
end;
$$;
revoke all on function internal.reassign_queue_claim(text, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.reassign_queue_claim(text, uuid, uuid, text) to authenticated;
create function api.reassign_queue_claim(p_subject text, p_id uuid, p_to uuid, p_reason text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.reassign_queue_claim(p_subject, p_id, p_to, p_reason);
$$;
revoke all on function api.reassign_queue_claim(text, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.reassign_queue_claim(text, uuid, uuid, text) to authenticated;

-- Holder: my live claims, with their tuples (after a reload or a reassignment).
create function internal.my_queue_claims()
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('queue:claim');
begin
  return coalesce((select jsonb_agg(internal.queue_claim_view(q) order by q.claim_expires_at, q.id)
    from private.queue_claims q where q.claimed_by = actor and q.claim_expires_at > clock_timestamp()), '[]'::jsonb);
end;
$$;
revoke all on function internal.my_queue_claims() from public, anon, authenticated, service_role;
grant execute on function internal.my_queue_claims() to authenticated;
create function api.my_queue_claims()
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.my_queue_claims();
$$;
revoke all on function api.my_queue_claims() from public, anon, authenticated, service_role;
grant execute on function api.my_queue_claims() to authenticated;

-- What a reviewer sees of a post: the submitted content, details and media,
-- whether or not it is public. Object keys are random (public pages show them).
create function internal.post_review_view(p_post_id uuid)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'area', p.area, 'category', p.category_key,
    'activity', p.activity_key, 'status', p.status, 'revision', p.revision, 'edit_of', p.edit_of,
    'title', p.title, 'description', p.description, 'province', p.province_id, 'city', p.city_id,
    'locality', p.locality_label, 'submitted_at', p.submitted_at,
    'price_mode', l.price_mode, 'price_cents', l.price_cents::text, 'price_negotiable', l.price_negotiable,
    'attributes', l.attributes, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'timezone', e.timezone,
    'media', coalesce((select jsonb_agg(jsonb_build_object('purpose', pm.purpose, 'position', pm.position,
        'object_key', m.object_key, 'kind', m.kind, 'state', m.state, 'width', m.width, 'height', m.height)
        order by pm.purpose, pm.position)
      from private.post_media pm join private.media_objects m on m.id = pm.object_id where pm.post_id = p.id), '[]'))
  from private.posts p
  left join private.listing_details l on l.post_id = p.id
  left join private.event_details e on e.post_id = p.id
  where p.id = p_post_id;
$$;
revoke all on function internal.post_review_view(uuid) from public, anon, authenticated, service_role;

-- Staff: review DTO for a claimed post. An edit also shows the live version.
create function internal.staff_review_post(p_post_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('post:moderate'); c private.queue_claims; dto jsonb;
begin
  select q.* into c from private.queue_claims q join private.posts p on p.id = q.post_id
    where q.post_id = p_post_id and p.status = 'pending_moderation';
  if internal.queue_conflict(actor, p_post_id, null) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  perform internal.assert_queue_claim(c, actor, p_claim_generation, p_claim_nonce);
  dto := internal.post_review_view(p_post_id);
  if dto->>'edit_of' is not null then
    dto := dto || jsonb_build_object('live_version', internal.post_review_view((dto->>'edit_of')::uuid));
  end if;
  return dto;
end;
$$;
revoke all on function internal.staff_review_post(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.staff_review_post(uuid, text, uuid) to authenticated;
create function api.staff_review_post(p_post_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.staff_review_post(p_post_id, p_claim_generation, p_claim_nonce);
$$;
revoke all on function api.staff_review_post(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.staff_review_post(uuid, text, uuid) to authenticated;

-- Server only (after Turnstile and rate limiting): file a report about a post
-- that is public right now. The route passes the verified reporter account,
-- if any, and an HMAC of the client IP; the database never sees the IP.
create function internal.submit_report(p_post_id uuid, p_category text, p_description text,
  p_reporter_id uuid, p_reporter_ip_hmac text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare subject uuid; body text; report_id uuid;
begin
  if p_category is null or p_category not in ('scam', 'prohibited_item', 'impersonation', 'harassment', 'misleading_info') then
    raise exception 'choose a report reason' using errcode = '22023';
  end if;
  if p_reporter_ip_hmac is null or p_reporter_ip_hmac !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'reporter fingerprint required' using errcode = '22023';
  end if;
  body := internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":2000}'::jsonb,
    to_jsonb(p_description)) #>> '{}';
  if body ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode = '22023';
  end if;
  if p_reporter_id is not null and not exists (select 1 from private.current_account_access u where u.id = p_reporter_id) then
    raise exception 'reporter account is not active' using errcode = '42501';
  end if;
  select p.owner_id into subject from private.posts p
    where p.id = p_post_id and exists (select 1 from private.public_eligible_posts e where e.id = p.id);
  if subject is null then raise exception 'post not found' using errcode = '22023'; end if;
  if subject = p_reporter_id then raise exception 'you cannot report your own post' using errcode = '22023'; end if;
  begin
    insert into private.reports (post_id, subject_account_id, category, description, reporter_id, reporter_ip_hmac)
    values (p_post_id, subject, p_category, body, p_reporter_id, p_reporter_ip_hmac)
    returning id into report_id;
  exception when unique_violation then
    raise exception 'you already reported this post' using errcode = 'PT409';
  end;
  return jsonb_build_object('id', report_id, 'status', 'open');
end;
$$;
revoke all on function internal.submit_report(uuid, text, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.submit_report(uuid, text, text, uuid, text) to service_role;
create function api.submit_report(p_post_id uuid, p_category text, p_description text,
  p_reporter_ip_hmac text, p_reporter_id uuid default null)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.submit_report(p_post_id, p_category, p_description, p_reporter_id, p_reporter_ip_hmac);
$$;
revoke all on function api.submit_report(uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.submit_report(uuid, text, text, text, uuid) to service_role;

-- Staff: review DTO for a claimed report. The reporter's identity is not shown;
-- whether they were signed in, and the subject's open-report count, are.
create function internal.staff_review_report(p_report_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('report:resolve'); c private.queue_claims; r private.reports;
begin
  select * into r from private.reports x where x.id = p_report_id and x.status = 'open';
  select q.* into c from private.queue_claims q where q.report_id = r.id;
  if internal.queue_conflict(actor, null, p_report_id) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  perform internal.assert_queue_claim(c, actor, p_claim_generation, p_claim_nonce);
  return jsonb_build_object('id', r.id, 'category', r.category, 'severity', r.severity,
    'description', r.description, 'status', r.status, 'created_at', r.created_at,
    'reporter_signed_in', r.reporter_id is not null, 'subject_account_id', r.subject_account_id,
    'subject_open_reports', (select count(*) from private.reports x
      where x.subject_account_id = r.subject_account_id and x.status = 'open'),
    'post', case when r.post_id is not null then internal.post_review_view(r.post_id) end);
end;
$$;
revoke all on function internal.staff_review_report(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.staff_review_report(uuid, text, uuid) to authenticated;
create function api.staff_review_report(p_report_id uuid, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.staff_review_report(p_report_id, p_claim_generation, p_claim_nonce);
$$;
revoke all on function api.staff_review_report(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.staff_review_report(uuid, text, uuid) to authenticated;

-- Staff: close a claimed report. Enforcement effects (take-down, restrictions,
-- appeals) are a separate slice and must use this same claim.
create function internal.resolve_report(p_report_id uuid, p_claim_generation text, p_claim_nonce uuid,
  p_outcome text, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('report:resolve'); s record; note text;
begin
  if p_outcome is null or p_outcome not in ('resolved', 'dismissed') then
    raise exception 'outcome must be resolved or dismissed' using errcode = '22023';
  end if;
  note := internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb, to_jsonb(p_note)) #>> '{}';
  if note ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode = '22023';
  end if;
  select * into s from internal.lock_queue_subject('report', p_report_id);
  actor := internal.staff_actor('report:resolve');
  if internal.queue_conflict(actor, null, p_report_id) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  perform internal.consume_queue_claim('report', p_report_id, actor, p_claim_generation, p_claim_nonce);
  perform internal.staff_actor('report:resolve'); -- authority after the claim-row wait
  update private.reports set status = p_outcome, resolution_note = note, resolved_by = actor,
    resolved_at = statement_timestamp()
  where id = p_report_id;
  return jsonb_build_object('id', p_report_id, 'status', p_outcome);
end;
$$;
revoke all on function internal.resolve_report(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function internal.resolve_report(uuid, text, uuid, text, text) to authenticated;
create function api.resolve_report(p_report_id uuid, p_claim_generation text, p_claim_nonce uuid,
  p_outcome text, p_note text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.resolve_report(p_report_id, p_claim_generation, p_claim_nonce, p_outcome, p_note);
$$;
revoke all on function api.resolve_report(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function api.resolve_report(uuid, text, uuid, text, text) to authenticated;
