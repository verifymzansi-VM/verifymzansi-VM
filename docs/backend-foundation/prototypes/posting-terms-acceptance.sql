-- Account acceptance is explicit and version-bound. No real document is seeded:
-- the target stays closed to submissions until reviewed terms are published.
create table private.posting_terms_versions (
  version text primary key check (version ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  document_hash text not null check (document_hash ~ '^[A-Za-z0-9_-]{43}$'),
  published_at timestamptz not null default clock_timestamp(),
  unique(version,document_hash)
);
create table private.posting_terms_current (
  singleton boolean primary key default true check (singleton),
  version text not null references private.posting_terms_versions(version) on delete restrict
);
create table private.posting_terms_acceptances (
  owner_id uuid not null references auth.users(id) on delete cascade,
  version text not null,
  document_hash text not null,
  accepted_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,version),
  foreign key(version,document_hash) references private.posting_terms_versions(version,document_hash)
);
alter table private.posting_terms_versions enable row level security;
alter table private.posting_terms_current enable row level security;
alter table private.posting_terms_acceptances enable row level security;
revoke all on private.posting_terms_versions,private.posting_terms_current,
  private.posting_terms_acceptances from public,anon,authenticated,service_role;

create function internal.guard_posting_terms_document()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  raise exception 'published terms are immutable; publish a new version' using errcode='23514';
end;
$$;
revoke all on function internal.guard_posting_terms_document() from public,anon,authenticated,service_role;
create trigger posting_terms_document_immutable before update or delete on private.posting_terms_versions
  for each row execute function internal.guard_posting_terms_document();
create trigger posting_terms_acceptance_immutable before update on private.posting_terms_acceptances
  for each row execute function internal.guard_posting_terms_document();

create function internal.get_current_posting_terms()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('version',v.version,'document_hash',v.document_hash,
    'document_path','/terms/versions/'||v.version)
  from private.posting_terms_current c join private.posting_terms_versions v using(version)
  where c.singleton;
$$;
revoke all on function internal.get_current_posting_terms() from public,anon,authenticated,service_role;
grant execute on function internal.get_current_posting_terms() to anon,authenticated;
create function api.get_current_posting_terms()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.get_current_posting_terms();
$$;
revoke all on function api.get_current_posting_terms() from public,anon,authenticated,service_role;
grant execute on function api.get_current_posting_terms() to anon,authenticated;

create function internal.get_owner_posting_terms()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); document jsonb; accepted timestamptz;
begin
  document:=internal.get_current_posting_terms();
  if document is null then return null; end if;
  select a.accepted_at into accepted from private.posting_terms_acceptances a
    where a.owner_id=actor and a.version=document->>'version'
      and a.document_hash=document->>'document_hash';
  perform internal.price_draft_actor();
  return document||jsonb_build_object('accepted_at',accepted);
end;
$$;
revoke all on function internal.get_owner_posting_terms() from public,anon,authenticated,service_role;
grant execute on function internal.get_owner_posting_terms() to authenticated;
create function api.get_owner_posting_terms()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_owner_posting_terms();
$$;
revoke all on function api.get_owner_posting_terms() from public,anon,authenticated,service_role;
grant execute on function api.get_owner_posting_terms() to authenticated;

create function internal.accept_posting_terms(p_version text,p_document_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); current_version text; current_hash text; accepted timestamptz;
begin
  -- Serialize acceptance with a policy switch, without taking post locks.
  select c.version into current_version from private.posting_terms_current c
    where c.singleton for share;
  perform internal.price_draft_actor();
  if current_version is null then
    raise exception 'posting terms are not available' using errcode='PT503',detail='posting_terms_unavailable';
  end if;
  select v.document_hash into current_hash from private.posting_terms_versions v
    where v.version=current_version;
  if p_version is distinct from current_version or p_document_hash is distinct from current_hash then
    raise exception 'posting terms changed; review the current document' using errcode='PT409',detail='posting_terms_changed';
  end if;
  insert into private.posting_terms_acceptances(owner_id,version,document_hash)
    values(actor,current_version,current_hash) on conflict(owner_id,version) do nothing;
  select a.accepted_at into accepted from private.posting_terms_acceptances a
    where a.owner_id=actor and a.version=current_version and a.document_hash=current_hash;
  perform internal.price_draft_actor();
  return jsonb_build_object('version',current_version,'document_hash',current_hash,
    'document_path','/terms/versions/'||current_version,'accepted_at',accepted);
end;
$$;
revoke all on function internal.accept_posting_terms(text,text) from public,anon,authenticated,service_role;
grant execute on function internal.accept_posting_terms(text,text) to authenticated;
create function api.accept_posting_terms(p_version text,p_document_hash text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.accept_posting_terms(p_version,p_document_hash);
$$;
revoke all on function api.accept_posting_terms(text,text) from public,anon,authenticated,service_role;
grant execute on function api.accept_posting_terms(text,text) to authenticated;

create function internal.guard_posting_terms_submission()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare current_version text; current_hash text;
begin
  if new.status<>'pending_moderation' then return new; end if;
  if tg_op='UPDATE' then
    if old.status='pending_moderation' then return new; end if;
  end if;
  -- The submission kernel separately enforces fresh owner/session authority.
  -- This guard enforces consent for every transition into the review queue,
  -- including direct API alternatives, without trusting client booleans.
  select c.version into current_version from private.posting_terms_current c
    where c.singleton for share;
  if current_version is null then
    raise exception 'posting terms are not available' using errcode='PT503',detail='posting_terms_unavailable';
  end if;
  select v.document_hash into current_hash from private.posting_terms_versions v
    where v.version=current_version;
  if not exists(select 1 from private.posting_terms_acceptances a
      where a.owner_id=new.owner_id and a.version=current_version and a.document_hash=current_hash) then
    raise exception 'accept current posting terms before submitting' using errcode='PT409',detail='posting_terms_required';
  end if;
  return new;
end;
$$;
revoke all on function internal.guard_posting_terms_submission() from public,anon,authenticated,service_role;
create trigger posting_terms_submission_guard before insert or update of status on private.posts
  for each row execute function internal.guard_posting_terms_submission();
