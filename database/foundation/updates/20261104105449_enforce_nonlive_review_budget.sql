-- Pausing a post must not bypass the same approved-edit/price-change limits
-- that apply to live review copies. Only real moderation approvals are counted.
begin;
create table private.frontend_offline_post_reviews(
  log_id bigint primary key references private.moderation_log(id) on delete cascade,
  post_id uuid not null references private.posts(id) on delete cascade,
  price_only boolean not null,decided_at timestamptz not null
);
create index frontend_offline_post_reviews_post_idx on private.frontend_offline_post_reviews(post_id,decided_at);
alter table private.frontend_offline_post_reviews enable row level security;
revoke all on private.frontend_offline_post_reviews from public,anon,authenticated,service_role;
alter table private.frontend_post_approval_snapshots add column structural_digest text check(structural_digest ~ '^[a-f0-9]{64}$');
create function internal.frontend_post_structural_digest(p_id uuid)
returns text language sql stable security invoker set search_path=pg_catalog as $$
 select encode(sha256(convert_to(jsonb_build_object(
   'post',to_jsonb(p)-array['status','status_reason','revision','published_at','visible_until','submitted_at','content_updated_at','status_changed_at'],
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
update private.frontend_post_approval_snapshots s set structural_digest=internal.frontend_post_structural_digest(s.post_id)
  where s.digest=internal.frontend_post_approval_digest(s.post_id);
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.approved_edit_count(uuid)'::regprocedure)<>'df657466788787e009855b6195175f71'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.recent_price_change(uuid)'::regprocedure)<>'b8a76bb5ca2fbf49998e9d6163c9bd58'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.capture_frontend_post_approval()'::regprocedure)<>'3e7c5c5cfbf5ed8f188e8855fa769bca' then raise exception 'offline review policy drift';end if;
end$$;
create or replace function internal.approved_edit_count(p_post_id uuid)
returns integer language sql stable security invoker set search_path=pg_catalog as $$
 select ((select count(*) from private.moderation_log l where l.post_id=p_post_id and l.edit_id is not null and l.decision='approve' and not l.price_only)
   +(select count(*) from private.frontend_offline_post_reviews r where r.post_id=p_post_id and not r.price_only))::integer;
$$;
create or replace function internal.recent_price_change(p_post_id uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
 select exists(select 1 from private.moderation_log l where l.post_id=p_post_id and l.price_only and l.decision='approve' and l.decided_at>statement_timestamp()-interval '24 hours')
   or exists(select 1 from private.frontend_offline_post_reviews r where r.post_id=p_post_id and r.price_only and r.decided_at>statement_timestamp()-interval '24 hours');
$$;
create function internal.guard_frontend_offline_review_budget()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare snapshot private.frontend_post_approval_snapshots;price_only boolean;kind text;
begin
  if new.decision<>'approve' or new.edit_id is not null then return new;end if;
  select * into snapshot from private.frontend_post_approval_snapshots where post_id=new.post_id;
  if not found or snapshot.digest=internal.frontend_post_approval_digest(new.post_id) then return new;end if;
  select p.kind into kind from private.posts p where p.id=new.post_id;
  price_only:=kind='listing' and snapshot.structural_digest is not null and snapshot.structural_digest=internal.frontend_post_structural_digest(new.post_id);
  if price_only and internal.recent_price_change(new.post_id) then raise exception 'one approved price change per day' using errcode='PT429';end if;
  if not price_only and internal.approved_edit_count(new.post_id)>=internal.edit_allowance(new.post_id) then
    raise exception 'approved edit allowance reached' using errcode='PT409';end if;
  return new;
end$$;
revoke all on function internal.guard_frontend_offline_review_budget() from public,anon,authenticated,service_role;
create trigger guard_frontend_offline_review_budget before insert on private.moderation_log for each row execute function internal.guard_frontend_offline_review_budget();
create or replace function internal.capture_frontend_post_approval()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare snapshot private.frontend_post_approval_snapshots;digest text;structural text;kind text;
begin
  if new.decision='approve' and exists(select 1 from private.posts p where p.id=new.post_id and p.status='live' and p.edit_of is null) then
    select * into snapshot from private.frontend_post_approval_snapshots where post_id=new.post_id;
    digest:=internal.frontend_post_approval_digest(new.post_id);structural:=internal.frontend_post_structural_digest(new.post_id);
    select p.kind into kind from private.posts p where p.id=new.post_id;
    if snapshot.post_id is not null and snapshot.digest<>digest and new.edit_id is null then
      insert into private.frontend_offline_post_reviews(log_id,post_id,price_only,decided_at)
        values(new.id,new.post_id,kind='listing' and snapshot.structural_digest is not null and snapshot.structural_digest=structural,new.decided_at);
    end if;
    insert into private.frontend_post_approval_snapshots(post_id,digest,structural_digest,approved_at) values(new.post_id,digest,structural,new.decided_at)
      on conflict(post_id) do update set digest=excluded.digest,structural_digest=excluded.structural_digest,approved_at=excluded.approved_at;
  end if;return new;
end$$;
commit;
