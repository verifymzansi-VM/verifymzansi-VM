-- LOCAL CANDIDATE. Not released or applied to a hosted schema.
-- DEC-32: administrator suspicion is separate from exact-core admission and enforcement.
do $staff_event_duplicate_flags$
begin
insert into private.staff_capabilities(role,capability,requires_recent_mfa)
values('admin','event:flag_duplicate',true);

alter table private.reports
  add column report_origin text not null default 'public',
  add column duplicate_post_a uuid,
  add column duplicate_post_b uuid,
  add column duplicate_revision_a integer,
  add column duplicate_revision_b integer,
  add column duplicate_owner_b uuid,
  add column duplicate_created_by uuid;
alter table private.reports alter column reporter_ip_hmac drop not null;
alter table private.reports drop constraint reports_category_check;
alter table private.reports add constraint reports_category_check check(
  category in('scam','prohibited_item','impersonation','harassment','misleading_info','duplicate_event'));
alter table private.reports add constraint reports_origin_shape check(
  (report_origin='public' and category in('scam','prohibited_item','impersonation','harassment','misleading_info')
    and reporter_ip_hmac is not null
    and num_nonnulls(duplicate_post_a,duplicate_post_b,duplicate_revision_a,duplicate_revision_b,
      duplicate_owner_b,duplicate_created_by)=0)
  or
  (report_origin='staff' and category='duplicate_event' and reporter_ip_hmac is null
    and (reporter_id is null or reporter_id=duplicate_created_by)
    and num_nonnulls(duplicate_post_a,duplicate_post_b,duplicate_revision_a,duplicate_revision_b,
      duplicate_owner_b,duplicate_created_by)=6
    and duplicate_post_a<duplicate_post_b
    and duplicate_revision_a>0 and duplicate_revision_b>0
    and (post_id is null or post_id=duplicate_post_a)));
drop index private.reports_one_open_signed_in_idx;
drop index private.reports_one_open_anonymous_idx;
create unique index reports_one_open_signed_in_idx on private.reports(post_id,reporter_id)
  where report_origin='public' and status='open' and reporter_id is not null;
create unique index reports_one_open_anonymous_idx on private.reports(post_id,reporter_ip_hmac)
  where report_origin='public' and status='open' and reporter_id is null;
create unique index reports_one_open_duplicate_pair_idx on private.reports(duplicate_post_a,duplicate_post_b)
  where report_origin='staff' and status='open';
-- Plain UUID snapshots intentionally survive post deletion without adding a
-- related-account FK that would prevent that unrelated account's removal.

create function internal.report_identity_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (new.id,new.report_origin,new.subject_account_id,new.category,new.severity,new.description,
      new.reporter_ip_hmac,new.created_at,new.duplicate_post_a,new.duplicate_post_b,
      new.duplicate_revision_a,new.duplicate_revision_b,new.duplicate_owner_b,new.duplicate_created_by)
    is distinct from
    (old.id,old.report_origin,old.subject_account_id,old.category,old.severity,old.description,
      old.reporter_ip_hmac,old.created_at,old.duplicate_post_a,old.duplicate_post_b,
      old.duplicate_revision_a,old.duplicate_revision_b,old.duplicate_owner_b,old.duplicate_created_by)
    or (new.post_id is distinct from old.post_id and new.post_id is not null)
    or (new.reporter_id is distinct from old.reporter_id and new.reporter_id is not null) then
    raise exception 'report identity and original statement are immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.report_identity_guard() from public,anon,authenticated,service_role;
create trigger reports_identity before update on private.reports
  for each row execute function internal.report_identity_guard();

create function internal.lock_duplicate_event_pair(p_a uuid,p_b uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if p_a is null or p_b is null or p_a>=p_b then
    raise exception 'choose two different event posts' using errcode='22023';
  end if;
  -- Preserve key-share FK checks while serializing actual content/state/deletion.
  perform p.id from private.posts p where p.id in(p_a,p_b) order by p.id for no key update;
end;
$$;
revoke all on function internal.lock_duplicate_event_pair(uuid,uuid) from public,anon,authenticated,service_role;

create function internal.duplicate_public_event_view(p_id uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select jsonb_build_object('id',p.id,'revision',p.revision,'title',p.title,
    'description',p.description,'category',p.category_key,'activity',p.activity_key,
    'province',p.province_id,'city',p.city_id,
    'locality',coalesce(p.locality_label,(select c.label from private.cities c where c.id=p.city_id)),
    'event_window',jsonb_build_object(
      'starts_at',to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ends_at',to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone',e.timezone))
  from private.posts p join private.event_details e on e.post_id=p.id
  where p.id=p_id and p.kind='event' and p.edit_of is null
    and p.visible_until>clock_timestamp() and e.ends_at>clock_timestamp()
    and exists(select 1 from private.public_eligible_posts eligible where eligible.id=p.id);
$$;
revoke all on function internal.duplicate_public_event_view(uuid) from public,anon,authenticated,service_role;

create function internal.preview_duplicate_events(p_post_a uuid,p_post_b uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('event:flag_duplicate'); a uuid; b uuid;
  view_a jsonb; view_b jsonb; flag uuid;
begin
  if p_post_a is null or p_post_b is null or p_post_a=p_post_b then
    raise exception 'choose two different event posts' using errcode='22023';
  end if;
  a:=least(p_post_a,p_post_b); b:=greatest(p_post_a,p_post_b);
  perform internal.lock_duplicate_event_pair(a,b);
  actor:=internal.staff_actor('event:flag_duplicate');
  view_a:=internal.duplicate_public_event_view(a);
  view_b:=internal.duplicate_public_event_view(b);
  perform internal.staff_actor('event:flag_duplicate');
  if view_a is null or view_b is null then
    raise exception 'event pair is unavailable' using errcode='22023';
  end if;
  if exists(select 1 from private.posts p where p.id in(a,b) and p.owner_id=actor) then
    raise exception 'you cannot flag your own event' using errcode='42501';
  end if;
  select r.id into flag from private.reports r where r.report_origin='staff'
    and r.status='open' and r.duplicate_post_a=a and r.duplicate_post_b=b;
  perform internal.staff_actor('event:flag_duplicate');
  return jsonb_build_object('post_a',view_a,'post_b',view_b,'open_flag_id',flag);
end;
$$;
revoke all on function internal.preview_duplicate_events(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.preview_duplicate_events(uuid,uuid) to authenticated;
create function api.preview_duplicate_events(p_post_a uuid,p_post_b uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.preview_duplicate_events(p_post_a,p_post_b);
$$;
revoke all on function api.preview_duplicate_events(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function api.preview_duplicate_events(uuid,uuid) to authenticated;

create function internal.flag_duplicate_events(p_post_a uuid,p_expected_revision_a integer,
  p_post_b uuid,p_expected_revision_b integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('event:flag_duplicate'); a uuid; b uuid;
  revision_a integer; revision_b integer; post_a private.posts; post_b private.posts;
  view_a jsonb; view_b jsonb; flag uuid; reason text;
begin
  if p_post_a is null or p_post_b is null or p_post_a=p_post_b then
    raise exception 'choose two different event posts' using errcode='22023';
  end if;
  if p_expected_revision_a is null or p_expected_revision_b is null
    or p_expected_revision_a<1 or p_expected_revision_b<1 then
    raise exception 'positive expected revisions required' using errcode='22023';
  end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":2000}'::jsonb,
    to_jsonb(p_reason)) #>> '{}';
  if reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode='22023';
  end if;
  a:=least(p_post_a,p_post_b); b:=greatest(p_post_a,p_post_b);
  revision_a:=case when a=p_post_a then p_expected_revision_a else p_expected_revision_b end;
  revision_b:=case when b=p_post_b then p_expected_revision_b else p_expected_revision_a end;
  perform internal.lock_duplicate_event_pair(a,b);
  actor:=internal.staff_actor('event:flag_duplicate');
  select * into post_a from private.posts p where p.id=a;
  select * into post_b from private.posts p where p.id=b;
  view_a:=internal.duplicate_public_event_view(a);
  view_b:=internal.duplicate_public_event_view(b);
  perform internal.staff_actor('event:flag_duplicate');
  if view_a is null or view_b is null then
    raise exception 'event pair is unavailable' using errcode='22023';
  end if;
  if post_a.owner_id=actor or post_b.owner_id=actor then
    raise exception 'you cannot flag your own event' using errcode='42501';
  end if;
  if post_a.revision<>revision_a or post_b.revision<>revision_b then
    raise exception 'event pair changed since review' using errcode='PT409',detail='event_pair_changed';
  end if;
  select r.id into flag from private.reports r where r.report_origin='staff'
    and r.status='open' and r.duplicate_post_a=a and r.duplicate_post_b=b;
  perform internal.staff_actor('event:flag_duplicate');
  if flag is not null then return jsonb_build_object('id',flag,'status','open','reused',true,'post_a',a,'post_b',b); end if;
  insert into private.reports(post_id,subject_account_id,category,description,reporter_id,reporter_ip_hmac,
    report_origin,duplicate_post_a,duplicate_post_b,duplicate_revision_a,duplicate_revision_b,
    duplicate_owner_b,duplicate_created_by)
  values(a,post_a.owner_id,'duplicate_event',reason,actor,null,'staff',a,b,revision_a,revision_b,post_b.owner_id,actor)
  returning id into flag;
  perform internal.staff_actor('event:flag_duplicate');
  view_a:=internal.duplicate_public_event_view(a);
  view_b:=internal.duplicate_public_event_view(b);
  perform internal.staff_actor('event:flag_duplicate');
  if view_a is null or view_b is null then
    raise exception 'event pair changed since review' using errcode='PT409',detail='event_pair_changed';
  end if;
  return jsonb_build_object('id',flag,'status','open','reused',false,'post_a',a,'post_b',b);
end;
$$;
revoke all on function internal.flag_duplicate_events(uuid,integer,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.flag_duplicate_events(uuid,integer,uuid,integer,text) to authenticated;
create function api.flag_duplicate_events(p_post_a uuid,p_expected_revision_a integer,
  p_post_b uuid,p_expected_revision_b integer,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.flag_duplicate_events(p_post_a,p_expected_revision_a,p_post_b,p_expected_revision_b,p_reason);
$$;
revoke all on function api.flag_duplicate_events(uuid,integer,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function api.flag_duplicate_events(uuid,integer,uuid,integer,text) to authenticated;

create or replace function internal.queue_conflict(p_actor uuid,p_post_id uuid,p_report_id uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select case when p_post_id is not null
    then exists(select 1 from private.posts p where p.id=p_post_id and p.owner_id=p_actor)
    else exists(select 1 from private.reports r where r.id=p_report_id and
      (r.reporter_id=p_actor or r.subject_account_id=p_actor
       or r.duplicate_owner_b=p_actor or r.duplicate_created_by=p_actor))
  end;
$$;
revoke all on function internal.queue_conflict(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function internal.claim_queue_items(p_queue text, p_limit integer)
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
      where x.status = 'open' and not internal.queue_conflict(actor,null,x.id)
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
revoke all on function internal.claim_queue_items(text,integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_queue_items(text,integer) to authenticated;

create or replace function internal.staff_review_report(p_report_id uuid,p_claim_generation text,p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('report:resolve'); c private.queue_claims; r private.reports; result jsonb;
begin
  -- Never acquire base-post locks after holding a report: deletion takes the
  -- post first and its report FK second. Return current public data or null.
  select * into r from private.reports x where x.id=p_report_id for update;
  actor:=internal.staff_actor('report:resolve');
  c:=internal.lock_queue_claim(null,r.id);
  actor:=internal.staff_actor('report:resolve');
  if internal.queue_conflict(actor,null,p_report_id) then
    raise exception 'self-review is not allowed' using errcode='42501';
  end if;
  perform internal.assert_queue_claim(c,actor,p_claim_generation,p_claim_nonce);
  if r.status is distinct from 'open' then
    raise exception 'current live queue claim required' using errcode='42501';
  end if;
  if r.report_origin='staff' then
    result:=jsonb_build_object('id',r.id,'origin','staff','category','duplicate_event',
      'description',r.description,'status',r.status,'created_at',r.created_at,
      'post_a',jsonb_build_object('id',r.duplicate_post_a,'reported_revision',r.duplicate_revision_a,
        'current',internal.duplicate_public_event_view(r.duplicate_post_a)),
      'post_b',jsonb_build_object('id',r.duplicate_post_b,'reported_revision',r.duplicate_revision_b,
        'current',internal.duplicate_public_event_view(r.duplicate_post_b)));
  else
    result:=jsonb_build_object('id',r.id,'category',r.category,'severity',r.severity,
      'description',r.description,'status',r.status,'created_at',r.created_at,
      'reporter_signed_in',r.reporter_id is not null,'subject_account_id',r.subject_account_id,
      'subject_open_reports',(select count(*) from private.reports x
        where x.subject_account_id=r.subject_account_id and x.status='open'),
      'post',case when r.post_id is not null then internal.post_review_view(r.post_id) end);
  end if;
  perform internal.staff_actor('report:resolve');
  select q.* into c from private.queue_claims q where q.report_id=r.id;
  perform internal.assert_queue_claim(c,actor,p_claim_generation,p_claim_nonce);
  return result;
end;
$$;
revoke all on function internal.staff_review_report(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.staff_review_report(uuid,text,uuid) to authenticated;
perform pg_catalog.pg_notify('pgrst','reload schema');
end;
$staff_event_duplicate_flags$;
