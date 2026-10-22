-- Owner inbox: enquiries on live posts, owner notifications and owner-only
-- Realtime signals. Buyer contact details are private to the post owner.
-- Submission is a trusted server command (Turnstile, rate limits and the
-- verified sender are checked by the website before it calls this), and SQL
-- enforces post eligibility, contact choice, sender authority and flood limits
-- again inside the transaction. Realtime carries no content: owners receive a
-- bare "inbox changed" signal on a private per-account topic and reread
-- through the API.

-- Plain text: NFC, trimmed, bounded, no control, zero-width or bidirectional
-- override characters. Multiline text may contain newlines only.
create function internal.plain_text_valid(p_value text,p_min integer,p_max integer,p_multiline boolean)
returns boolean language sql immutable parallel safe security invoker set search_path=pg_catalog as $$
  select p_value is not null and char_length(p_value) between p_min and p_max
    and p_value is nfc normalized
    and p_value=btrim(p_value,' '||chr(10))
    and p_value !~ ('['||chr(1)||'-'||chr(9)||chr(11)||'-'||chr(31)||chr(127)||'-'||chr(159)||chr(173)
      ||chr(1564)||chr(6158)||chr(8203)||'-'||chr(8207)||chr(8232)||'-'||chr(8238)||chr(8288)||'-'||chr(8303)
      ||chr(65279)||chr(65529)||'-'||chr(65531)||']')
    and (p_multiline or strpos(p_value,chr(10))=0);
$$;
revoke all on function internal.plain_text_valid(text,integer,integer,boolean) from public,anon,authenticated,service_role;

-- Lower-case address, no display name or quoting.
create function internal.enquiry_email_valid(p_email text)
returns boolean language sql immutable parallel safe security invoker set search_path=pg_catalog as $$
  select p_email is not null and char_length(p_email)<=254 and p_email=lower(p_email)
    and p_email ~ '^[a-z0-9._%+-]{1,64}@[a-z0-9-]+([.][a-z0-9-]+)*[.][a-z]{2,63}$';
$$;
revoke all on function internal.enquiry_email_valid(text) from public,anon,authenticated,service_role;

create table private.enquiries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  request_id uuid not null unique,
  post_id uuid not null references private.posts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  sender_account_id uuid references auth.users(id) on delete set null,
  buyer_name text check(buyer_name is null or internal.plain_text_valid(buyer_name,2,80,false)),
  buyer_email text not null check(internal.enquiry_email_valid(buyer_email)),
  email_confirmed boolean not null,
  buyer_phone text check(buyer_phone is null or buyer_phone ~ '^[+]27[0-9]{9}$'),
  message text not null check(internal.plain_text_valid(message,10,1000,true)),
  status text not null default 'new' check(status in('new','read','contacted','closed')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  retain_until timestamptz not null,
  check(retain_until=created_at+interval '12 months'),
  check(sender_account_id is distinct from owner_id)
);
create index enquiries_owner_inbox_idx on private.enquiries(owner_id,created_at desc,id desc);
create index enquiries_owner_new_idx on private.enquiries(owner_id) where status='new';
create index enquiries_post_flood_idx on private.enquiries(post_id,created_at);
create index enquiries_email_flood_idx on private.enquiries(buyer_email,created_at);
create index enquiries_sender_idx on private.enquiries(sender_account_id) where sender_account_id is not null;
create index enquiries_retention_idx on private.enquiries(retain_until);
alter table private.enquiries enable row level security;
revoke all on private.enquiries from public,anon,authenticated,service_role;

-- Only the owner's status changes; everything a buyer sent is immutable.
create function internal.enquiry_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.request_id,new.post_id,new.owner_id,new.buyer_name,new.buyer_email,new.email_confirmed,
      new.buyer_phone,new.message,new.created_at,new.retain_until)
    is distinct from (old.id,old.request_id,old.post_id,old.owner_id,old.buyer_name,old.buyer_email,old.email_confirmed,
      old.buyer_phone,old.message,old.created_at,old.retain_until)
    or (new.sender_account_id is distinct from old.sender_account_id and new.sender_account_id is not null) then
    raise exception 'enquiries are immutable except their status' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function internal.enquiry_guard() from public,anon,authenticated,service_role;
create trigger enquiry_guard before update on private.enquiries
  for each row execute function internal.enquiry_guard();

-- Owner notifications. Wording is rendered by the app from the closed kind,
-- so no free text or link is stored.
create table private.notifications (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in('enquiry_received')),
  subject_id uuid not null,
  post_id uuid references private.posts(id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(),
  read_at timestamptz,
  unique(kind,subject_id),
  check(read_at is null or read_at>=created_at)
);
create index notifications_account_idx on private.notifications(account_id,created_at desc,id desc);
create index notifications_unread_idx on private.notifications(account_id) where read_at is null;
create index notifications_post_idx on private.notifications(post_id) where post_id is not null;
create index notifications_retention_idx on private.notifications(created_at);
alter table private.notifications enable row level security;
revoke all on private.notifications from public,anon,authenticated,service_role;

create function internal.notification_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.account_id,new.kind,new.subject_id,new.post_id,new.created_at)
      is distinct from (old.id,old.account_id,old.kind,old.subject_id,old.post_id,old.created_at)
    or (old.read_at is not null and new.read_at is distinct from old.read_at) then
    raise exception 'notifications are immutable except first read' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function internal.notification_guard() from public,anon,authenticated,service_role;
create trigger notification_guard before update on private.notifications
  for each row execute function internal.notification_guard();

-- Owner email alerts are delivered from the outbox by the server worker.
alter table private.outbox_events drop constraint outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check (kind in ('payment_completed',
  'payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
  'draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received'));

-- Content-free "inbox changed" signal on the owner's private topic. Realtime is
-- a hosted component: where it is absent (local fixtures) this is a no-op.
create function internal.signal_owner_inbox(p_owner uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute 'select realtime.send($1,$2,$3,true)'
      using jsonb_build_object('kind','inbox'),'inbox_changed','owner:'||p_owner::text;
  end if;
end;
$$;
revoke all on function internal.signal_owner_inbox(uuid) from public,anon,authenticated,service_role;

-- Realtime join authority for private owner topics: only the account itself,
-- with a live, active session.
create function internal.can_receive_owner_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid(); claims jsonb:=auth.jwt();
begin
  return actor is not null and p_topic='owner:'||actor::text
    and claims->>'role'='authenticated' and not coalesce((claims->>'is_anonymous')::boolean,false)
    and exists(select 1 from private.current_account_access a where a.id=actor)
    and exists(select 1 from auth.sessions s where s.id::text=claims->>'session_id' and s.user_id=actor
      and (s.not_after is null or s.not_after>clock_timestamp()));
end;
$$;
revoke all on function internal.can_receive_owner_topic(text) from public,anon,authenticated,service_role;
grant execute on function internal.can_receive_owner_topic(text) to authenticated;

do $owner_topic_policy$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'create policy owner_inbox_receive on realtime.messages for select to authenticated '
      ||'using (realtime.messages.extension=''broadcast'' and internal.can_receive_owner_topic((select realtime.topic())))';
  end if;
end;
$owner_topic_policy$;

-- Trusted server command. The website verifies Turnstile, its own rate limit
-- and the optional signed-in sender before calling; SQL never trusts a
-- client-supplied "confirmed" flag and rechecks everything that grants access.
create function internal.submit_enquiry(p_request_id uuid,p_post_id uuid,p_sender uuid,p_buyer_name text,
  p_buyer_email text,p_buyer_phone text,p_message text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare post private.posts; e private.enquiries; confirmed boolean:=false; channels text[];
begin
  if p_request_id is null or p_post_id is null
    or (p_buyer_name is not null and not internal.plain_text_valid(p_buyer_name,2,80,false))
    or not internal.enquiry_email_valid(p_buyer_email)
    or (p_buyer_phone is not null and p_buyer_phone !~ '^[+]27[0-9]{9}$')
    or not internal.plain_text_valid(p_message,10,1000,true) then
    raise exception 'enquiry details are invalid' using errcode='22023',detail='enquiry_invalid'; end if;
  select x.* into e from private.enquiries x where x.request_id=p_request_id;
  if found then
    if (e.post_id,e.sender_account_id,e.buyer_name,e.buyer_email,e.buyer_phone,e.message)
      is distinct from (p_post_id,p_sender,p_buyer_name,p_buyer_email,p_buyer_phone,p_message) then
      raise exception 'request reused for a different enquiry' using errcode='PT409',detail='enquiry_request_conflict'; end if;
    return jsonb_build_object('id',e.id,'reused',true);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('enquiry:'||p_post_id::text,0));
  select p.* into post from private.posts p where p.id=p_post_id for share;
  if not found or not exists(select 1 from private.public_eligible_posts x where x.id=p_post_id)
    or not exists(select 1 from private.post_search_documents d where d.post_id=p_post_id and d.is_visible
      and (d.visible_until is null or d.visible_until>statement_timestamp())) then
    raise exception 'post unavailable' using errcode='PT404',detail='post_unavailable'; end if;
  if post.kind='event' then
    select c.channels into channels from private.post_contacts c where c.post_id=post.id;
    if channels is null or not 'form'=any(channels) then
      raise exception 'enquiries are not enabled for this post' using errcode='PT403',detail='enquiries_disabled'; end if;
  end if;
  if p_sender is not null then
    if not exists(select 1 from private.current_account_access a where a.id=p_sender) then
      raise exception 'sender account is not active' using errcode='42501',detail='sender_inactive'; end if;
    if p_sender=post.owner_id then
      raise exception 'owners cannot enquire on their own post' using errcode='22023',detail='own_post'; end if;
    confirmed:=exists(select 1 from auth.users u where u.id=p_sender and u.email_confirmed_at is not null
      and lower(u.email)=p_buyer_email);
  end if;
  if (select count(*) from private.enquiries x where x.post_id=post.id and x.buyer_email=p_buyer_email
        and x.created_at>statement_timestamp()-interval '24 hours')>=3
    or (select count(*) from private.enquiries x where x.post_id=post.id
        and x.created_at>statement_timestamp()-interval '24 hours')>=100
    or (select count(*) from private.enquiries x where x.buyer_email=p_buyer_email
        and x.created_at>statement_timestamp()-interval '1 hour')>=10 then
    raise exception 'too many enquiries; try again later' using errcode='PT429',detail='enquiry_limit'; end if;
  insert into private.enquiries(request_id,post_id,owner_id,sender_account_id,buyer_name,buyer_email,email_confirmed,
    buyer_phone,message,retain_until)
  values(p_request_id,post.id,post.owner_id,p_sender,p_buyer_name,p_buyer_email,confirmed,p_buyer_phone,p_message,
    statement_timestamp()+interval '12 months')
  returning * into e;
  insert into private.notifications(account_id,kind,subject_id,post_id) values(post.owner_id,'enquiry_received',e.id,post.id);
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
    values('enquiry_received',e.id,post.owner_id,'enquiry_received:'||e.id::text);
  perform internal.signal_owner_inbox(post.owner_id);
  return jsonb_build_object('id',e.id,'reused',false);
end;
$$;
revoke all on function internal.submit_enquiry(uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.submit_enquiry(uuid,uuid,uuid,text,text,text,text) to service_role;
create function api.submit_enquiry(p_request_id uuid,p_post_id uuid,p_buyer_email text,p_message text,
  p_sender uuid default null,p_buyer_name text default null,p_buyer_phone text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.submit_enquiry(p_request_id,p_post_id,p_sender,p_buyer_name,p_buyer_email,p_buyer_phone,p_message);
$$;
revoke all on function api.submit_enquiry(uuid,uuid,text,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function api.submit_enquiry(uuid,uuid,text,text,uuid,text,text) to service_role;

create function internal.inbox_page_limit(p_limit integer,p_before_created timestamptz,p_before_id uuid)
returns void language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
  if p_limit is null or p_limit not between 1 and 50 or (p_before_created is null)<>(p_before_id is null) then
    raise exception 'invalid inbox page' using errcode='22023',detail='inbox_page_invalid'; end if;
end;
$$;
revoke all on function internal.inbox_page_limit(integer,timestamptz,uuid) from public,anon,authenticated,service_role;

create function internal.list_my_enquiries(p_status text,p_before_created timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); items jsonb; last private.enquiries; unread integer;
begin
  perform internal.inbox_page_limit(p_limit,p_before_created,p_before_id);
  if p_status is not null and p_status not in('new','read','contacted','closed') then
    raise exception 'invalid inbox page' using errcode='22023',detail='inbox_page_invalid'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'post_id',x.post_id,'post_kind',p.kind,'post_title',p.title,
      'buyer_name',x.buyer_name,'buyer_email',x.buyer_email,'buyer_phone',x.buyer_phone,
      'email_confirmed',x.email_confirmed,'message',x.message,'status',x.status,'created_at',x.created_at,
      'updated_at',x.updated_at) order by x.created_at desc,x.id desc),'[]')
    into items
  from (select * from private.enquiries x where x.owner_id=actor and (p_status is null or x.status=p_status)
      and (p_before_created is null or (x.created_at,x.id)<(p_before_created,p_before_id))
      order by x.created_at desc,x.id desc limit p_limit) x
  join private.posts p on p.id=x.post_id;
  select x.* into last from private.enquiries x where x.owner_id=actor and (p_status is null or x.status=p_status)
    and (p_before_created is null or (x.created_at,x.id)<(p_before_created,p_before_id))
    order by x.created_at desc,x.id desc offset p_limit-1 limit 1;
  select count(*) into unread from private.enquiries x where x.owner_id=actor and x.status='new';
  return jsonb_build_object('items',items,'unread_count',unread,
    'next_cursor',case when last.id is not null and exists(select 1 from private.enquiries y where y.owner_id=actor
        and (p_status is null or y.status=p_status) and (y.created_at,y.id)<(last.created_at,last.id))
      then jsonb_build_object('before_created',last.created_at,'before_id',last.id) end);
end;
$$;
revoke all on function internal.list_my_enquiries(text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.list_my_enquiries(text,timestamptz,uuid,integer) to authenticated;
create function api.list_my_enquiries(p_limit integer default 25,p_status text default null,
  p_before_created timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.list_my_enquiries(p_status,p_before_created,p_before_id,p_limit);
$$;
revoke all on function api.list_my_enquiries(integer,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function api.list_my_enquiries(integer,text,timestamptz,uuid) to authenticated;

-- Owner status only; a foreign or missing id is indistinguishable (null).
create function internal.set_enquiry_status(p_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); e private.enquiries;
begin
  if p_status is null or p_status not in('read','contacted','closed') then
    raise exception 'invalid enquiry status' using errcode='22023',detail='enquiry_status_invalid'; end if;
  select x.* into e from private.enquiries x where x.id=p_id and x.owner_id=actor for update;
  if not found then return null; end if;
  perform internal.price_draft_actor();
  if e.status<>p_status then
    update private.enquiries set status=p_status,updated_at=statement_timestamp() where id=e.id returning * into e;
    update private.notifications set read_at=statement_timestamp()
      where account_id=actor and kind='enquiry_received' and subject_id=e.id and read_at is null;
    perform internal.signal_owner_inbox(actor);
  end if;
  return jsonb_build_object('id',e.id,'status',e.status,'updated_at',e.updated_at);
end;
$$;
revoke all on function internal.set_enquiry_status(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.set_enquiry_status(uuid,text) to authenticated;
create function api.set_enquiry_status(p_id uuid,p_status text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.set_enquiry_status(p_id,p_status);
$$;
revoke all on function api.set_enquiry_status(uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.set_enquiry_status(uuid,text) to authenticated;

create function internal.list_my_notifications(p_before_created timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); items jsonb; last private.notifications; unread integer;
begin
  perform internal.inbox_page_limit(p_limit,p_before_created,p_before_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'post_id',n.post_id,'post_title',p.title,
      'created_at',n.created_at,'read_at',n.read_at) order by n.created_at desc,n.id desc),'[]')
    into items
  from (select * from private.notifications n where n.account_id=actor
      and (p_before_created is null or (n.created_at,n.id)<(p_before_created,p_before_id))
      order by n.created_at desc,n.id desc limit p_limit) n
  left join private.posts p on p.id=n.post_id;
  select n.* into last from private.notifications n where n.account_id=actor
    and (p_before_created is null or (n.created_at,n.id)<(p_before_created,p_before_id))
    order by n.created_at desc,n.id desc offset p_limit-1 limit 1;
  select count(*) into unread from private.notifications n where n.account_id=actor and n.read_at is null;
  return jsonb_build_object('items',items,'unread_count',unread,
    'next_cursor',case when last.id is not null and exists(select 1 from private.notifications y where y.account_id=actor
        and (y.created_at,y.id)<(last.created_at,last.id))
      then jsonb_build_object('before_created',last.created_at,'before_id',last.id) end);
end;
$$;
revoke all on function internal.list_my_notifications(timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.list_my_notifications(timestamptz,uuid,integer) to authenticated;
create function api.list_my_notifications(p_limit integer default 25,p_before_created timestamptz default null,
  p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.list_my_notifications(p_before_created,p_before_id,p_limit);
$$;
revoke all on function api.list_my_notifications(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function api.list_my_notifications(integer,timestamptz,uuid) to authenticated;

-- Marks the given notifications (at most 100) or, with no ids, all of them.
create function internal.mark_my_notifications_read(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); changed integer; unread integer;
begin
  if p_ids is not null and (cardinality(p_ids) not between 1 and 100 or array_position(p_ids,null) is not null) then
    raise exception 'invalid notification ids' using errcode='22023',detail='notification_ids_invalid'; end if;
  update private.notifications set read_at=statement_timestamp()
    where account_id=actor and read_at is null and (p_ids is null or id=any(p_ids));
  get diagnostics changed=row_count;
  select count(*) into unread from private.notifications n where n.account_id=actor and n.read_at is null;
  if changed>0 then perform internal.signal_owner_inbox(actor); end if;
  return jsonb_build_object('marked',changed,'unread_count',unread);
end;
$$;
revoke all on function internal.mark_my_notifications_read(uuid[]) from public,anon,authenticated,service_role;
grant execute on function internal.mark_my_notifications_read(uuid[]) to authenticated;
create function api.mark_my_notifications_read(p_ids uuid[] default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.mark_my_notifications_read(p_ids);
$$;
revoke all on function api.mark_my_notifications_read(uuid[]) from public,anon,authenticated,service_role;
grant execute on function api.mark_my_notifications_read(uuid[]) to authenticated;

create function internal.get_my_inbox_counts()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();
begin
  return jsonb_build_object(
    'unread_enquiries',(select count(*) from private.enquiries x where x.owner_id=actor and x.status='new'),
    'unread_notifications',(select count(*) from private.notifications n where n.account_id=actor and n.read_at is null));
end;
$$;
revoke all on function internal.get_my_inbox_counts() from public,anon,authenticated,service_role;
grant execute on function internal.get_my_inbox_counts() to authenticated;
create function api.get_my_inbox_counts()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.get_my_inbox_counts();
$$;
revoke all on function api.get_my_inbox_counts() from public,anon,authenticated,service_role;
grant execute on function api.get_my_inbox_counts() to authenticated;

-- Scheduled retention: enquiries after 12 months, notifications after 90 days.
create function internal.purge_expired_inbox(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare enquiries integer; notifications integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  delete from private.notifications where id in(select n.id from private.notifications n
    where n.created_at<statement_timestamp()-interval '90 days' order by n.created_at limit p_limit for update skip locked);
  get diagnostics notifications=row_count;
  delete from private.enquiries where id in(select x.id from private.enquiries x
    where x.retain_until<=statement_timestamp() order by x.retain_until limit p_limit for update skip locked);
  get diagnostics enquiries=row_count;
  return jsonb_build_object('enquiries',enquiries,'notifications',notifications);
end;
$$;
revoke all on function internal.purge_expired_inbox(integer) from public,anon,authenticated,service_role;
grant execute on function internal.purge_expired_inbox(integer) to service_role;
create function api.purge_expired_inbox(p_limit integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.purge_expired_inbox(p_limit);
$$;
revoke all on function api.purge_expired_inbox(integer) from public,anon,authenticated,service_role;
grant execute on function api.purge_expired_inbox(integer) to service_role;
