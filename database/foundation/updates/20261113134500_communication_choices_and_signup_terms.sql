-- Communication choices are saved with their history, the member reads their
-- own email history, and the Terms version is recorded at every sign-up
-- (roadmap M1.7, finding SEC-09).
--
-- Only adds: no existing command, argument, grant, table or function body
-- changes, so the website release deployed before it keeps working. In one
-- transaction it:
--
-- 1. New table private.communication_choice_events: one row each time a member
--    turns an optional choice on or off (purposes marketing_email,
--    marketing_sms, analytics, third_party_sharing), with the version of the
--    switch wording the member saw and when. Rows are history and never
--    change (trigger communication_choice_events_immutable); they go with the
--    Auth user. A member's current choice is the latest row of that purpose;
--    with no row the choice is off, so everything optional starts off
--    (opt-in).
-- 2. New member read api.get_my_communication_choices() and member command
--    api.save_my_communication_choices(p_wording, p_marketing_email,
--    p_marketing_sms, p_analytics, p_third_party_sharing): a null choice stays
--    as it is, at least one must be given, and only a real change adds a row
--    (repeating a save adds nothing). At most 40 changes per account in 24
--    hours (PT429, detail choice_limit). Both return the four current choices.
--    Signed-in members only (internal.price_draft_actor: active account,
--    confirmed email, live session), each only ever for their own account.
-- 3. New member read api.list_my_email_history(p_limit): the member's own
--    queued account emails (private.outbox_events of their account) that are
--    finished: sent, or failed for good after the email job's 8 attempts. It
--    gives the message kind, sent or failed, and when; never the address,
--    the subject record or the provider's error. A new index
--    outbox_owner_history_idx serves it.
-- 4. New table private.signup_terms_acceptances: which Terms (version and
--    document hash of the current private.posting_terms_versions row, the
--    single set of Terms shown at /terms) a new account accepted at sign-up,
--    how, and when. One row per account, never changed (trigger
--    signup_terms_acceptances_immutable). A new trigger record_signup_terms
--    on auth.users fills it when the Auth user is created: method
--    'email_form' when the website's sign-up form, whose Terms box must be
--    ticked, sent the sign-up detail terms_accepted = true; method 'google'
--    for a Google sign-up, whose button says that continuing accepts the
--    Terms. Anonymous users and other sign-ups get no row. The trigger never
--    refuses a sign-up. The acceptance asked for before a first post
--    (private.posting_terms_acceptances) is separate and unchanged.
--
-- ORDER: apply this update before the pull request that uses it is merged (a
-- merge into main is deployed, and that release calls the new commands).
-- Read-only preflight:
-- ../preflight/20261113134500_communication_choices_and_signup_terms.check.sql.
-- Rollback: ../rollback/20261113134500_communication_choices_and_signup_terms.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Preconditions: the member check and the Terms tables this update reads are
-- the reviewed ones; everything this update adds is absent or exactly its own.
do $$
declare shape text;
begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.price_draft_actor()'))
      is distinct from '1d70271a4447ba5d1377f3f64a6cf029'
    or to_regclass('private.posting_terms_current') is null
    or to_regclass('private.posting_terms_versions') is null
    or to_regclass('private.outbox_events') is null then
    raise exception 'communication choices precondition: the reviewed member check and Terms tables are required'
      using errcode='55000';
  end if;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.guard_consent_record()'),('internal.communication_choices_dto(uuid)'),
      ('internal.get_my_communication_choices()'),('api.get_my_communication_choices()'),
      ('internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean)'),
      ('api.save_my_communication_choices(text,boolean,boolean,boolean,boolean)'),
      ('internal.list_my_email_history(integer)'),('api.list_my_email_history(integer)'),
      ('internal.record_signup_terms()')) v(sig)
  loop
    if shape not in (
        'internal.guard_consent_record() absent','internal.guard_consent_record() 867770c2b9c516fdd2b4e18ef6bd200c',
        'internal.communication_choices_dto(uuid) absent','internal.communication_choices_dto(uuid) 467064c26e0c111e1968f2fe6f58a649',
        'internal.get_my_communication_choices() absent','internal.get_my_communication_choices() 2437caf42b1e564d00c2678310dc3c1c',
        'api.get_my_communication_choices() absent','api.get_my_communication_choices() d19281f3b9241ccde77292cee7e7776a',
        'internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) absent',
        'internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) 62a40e158af34da3ab5cbcaf84753ab3',
        'api.save_my_communication_choices(text,boolean,boolean,boolean,boolean) absent',
        'api.save_my_communication_choices(text,boolean,boolean,boolean,boolean) 837c81b75ddfcf8c8b0042e50b3dcb6f',
        'internal.list_my_email_history(integer) absent','internal.list_my_email_history(integer) 4438f1596c1cc4e1dc0eca7139e17251',
        'api.list_my_email_history(integer) absent','api.list_my_email_history(integer) 00fcc1a073dc0bdbf0b19e6b80e10144',
        'internal.record_signup_terms() absent','internal.record_signup_terms() 24cf49d6570a6ca066cbde45173a3ed9') then
      raise exception 'communication choices function drift: %', shape using errcode='55000';
    end if;
  end loop;
  for shape in
    select v.name||' '||coalesce((select string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)
        ||case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
      from pg_catalog.pg_attribute a where a.attrelid=to_regclass(v.name) and a.attnum>0 and not a.attisdropped),'absent')
    from (values ('private.communication_choice_events'),('private.signup_terms_acceptances')) v(name)
  loop
    if shape not in ('private.communication_choice_events absent','private.signup_terms_acceptances absent',
        'private.communication_choice_events id:uuid!,account_id:uuid!,purpose:text!,granted:boolean!,'
          ||'wording_version:text!,recorded_at:timestamp with time zone!',
        'private.signup_terms_acceptances account_id:uuid!,version:text!,document_hash:text!,method:text!,'
          ||'accepted_at:timestamp with time zone!') then
      raise exception 'communication choices table drift: %', shape using errcode='55000';
    end if;
  end loop;
  for shape in
    select v.name||' '||case when to_regclass(v.name) is null then 'absent' else coalesce((select string_agg(s.n, ',' order by s.n collate "C") from (
        select c.conname::text as n from pg_catalog.pg_constraint c where c.conrelid=to_regclass(v.name) and c.contype <> 'n'
        union select i.relname::text from pg_catalog.pg_index x join pg_catalog.pg_class i on i.oid=x.indexrelid
          where x.indrelid=to_regclass(v.name)) s),'none') end
    from (values ('private.communication_choice_events'),('private.signup_terms_acceptances')) v(name)
  loop
    if shape not in ('private.communication_choice_events absent','private.signup_terms_acceptances absent',
        'private.communication_choice_events communication_choice_events_account_id_fkey,'
          ||'communication_choice_events_account_idx,communication_choice_events_pkey,'
          ||'communication_choice_events_purpose_check,communication_choice_events_wording_version_check',
        'private.signup_terms_acceptances signup_terms_acceptances_account_id_fkey,signup_terms_acceptances_document_fkey,'
          ||'signup_terms_acceptances_document_idx,signup_terms_acceptances_method_check,signup_terms_acceptances_pkey') then
      raise exception 'communication choices constraint or index drift: %', shape using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_class i join pg_catalog.pg_namespace n on n.oid=i.relnamespace
      where n.nspname='private' and i.relname='outbox_owner_history_idx')
    and pg_catalog.pg_get_indexdef(to_regclass('private.outbox_owner_history_idx'))
      is distinct from 'CREATE INDEX outbox_owner_history_idx ON private.outbox_events USING btree (owner_id, created_at DESC)' then
    raise exception 'communication choices index drift: private.outbox_owner_history_idx' using errcode='55000';
  end if;
end$$;

-- History rows never change. Deleting stays possible: they go with the Auth
-- user (on delete cascade), as the profile does.
CREATE OR REPLACE FUNCTION internal.guard_consent_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  raise exception 'consent records are history; record a new choice instead' using errcode='23514';
end;
$function$;
alter function internal.guard_consent_record() owner to postgres;
revoke all on function internal.guard_consent_record() from public, anon, authenticated, service_role;

-- 1. Communication choices, one row per change.
create table if not exists private.communication_choice_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete cascade,
  purpose text not null check (purpose in ('marketing_email', 'marketing_sms', 'analytics', 'third_party_sharing')),
  granted boolean not null,
  wording_version text not null check (wording_version ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table private.communication_choice_events enable row level security;
revoke all on table private.communication_choice_events from public, anon, authenticated, service_role;
create index if not exists communication_choice_events_account_idx
  on private.communication_choice_events (account_id, purpose, recorded_at desc);
drop trigger if exists communication_choice_events_immutable on private.communication_choice_events;
create trigger communication_choice_events_immutable before update on private.communication_choice_events
  for each row execute function internal.guard_consent_record();

-- 4. The Terms accepted at sign-up, one row per account.
create table if not exists private.signup_terms_acceptances (
  account_id uuid primary key references auth.users (id) on delete cascade,
  version text not null,
  document_hash text not null,
  method text not null check (method in ('email_form', 'google')),
  accepted_at timestamptz not null default clock_timestamp(),
  constraint signup_terms_acceptances_document_fkey foreign key (version, document_hash)
    references private.posting_terms_versions (version, document_hash)
);
alter table private.signup_terms_acceptances enable row level security;
revoke all on table private.signup_terms_acceptances from public, anon, authenticated, service_role;
create index if not exists signup_terms_acceptances_document_idx
  on private.signup_terms_acceptances (version, document_hash);
drop trigger if exists signup_terms_acceptances_immutable on private.signup_terms_acceptances;
create trigger signup_terms_acceptances_immutable before update on private.signup_terms_acceptances
  for each row execute function internal.guard_consent_record();

-- 3. The member's own email history.
create index if not exists outbox_owner_history_idx on private.outbox_events (owner_id, created_at desc);

-- The four current choices of one account; a purpose without a row is off.
CREATE OR REPLACE FUNCTION internal.communication_choices_dto(p_account uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'marketing_email', coalesce(bool_or(l.granted) filter (where l.purpose = 'marketing_email'), false),
    'marketing_sms', coalesce(bool_or(l.granted) filter (where l.purpose = 'marketing_sms'), false),
    'analytics', coalesce(bool_or(l.granted) filter (where l.purpose = 'analytics'), false),
    'third_party_sharing', coalesce(bool_or(l.granted) filter (where l.purpose = 'third_party_sharing'), false))
  from (select distinct on (e.purpose) e.purpose, e.granted
    from private.communication_choice_events e
    where e.account_id = p_account
    order by e.purpose, e.recorded_at desc, e.id desc) l;
$function$;
alter function internal.communication_choices_dto(uuid) owner to postgres;
revoke all on function internal.communication_choices_dto(uuid) from public, anon, authenticated, service_role;

-- 2. Read and save the caller's own choices.
CREATE OR REPLACE FUNCTION internal.get_my_communication_choices()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();
begin
  return internal.communication_choices_dto(actor);
end;
$function$;
alter function internal.get_my_communication_choices() owner to postgres;
revoke all on function internal.get_my_communication_choices() from public, anon, authenticated, service_role;
grant execute on function internal.get_my_communication_choices() to authenticated;

CREATE OR REPLACE FUNCTION api.get_my_communication_choices()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_my_communication_choices();
$function$;
alter function api.get_my_communication_choices() owner to postgres;
revoke all on function api.get_my_communication_choices() from public, anon, authenticated, service_role;
grant execute on function api.get_my_communication_choices() to authenticated;

CREATE OR REPLACE FUNCTION internal.save_my_communication_choices(p_wording text, p_marketing_email boolean DEFAULT NULL::boolean, p_marketing_sms boolean DEFAULT NULL::boolean, p_analytics boolean DEFAULT NULL::boolean, p_third_party_sharing boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); current_choices jsonb; wanted jsonb; changes integer; recent integer;
begin
  if p_wording is null or p_wording !~ '^[a-z0-9][a-z0-9-]{0,39}$' then
    raise exception 'invalid wording version' using errcode='22023', detail='choice_invalid';
  end if;
  if num_nonnulls(p_marketing_email, p_marketing_sms, p_analytics, p_third_party_sharing) = 0 then
    raise exception 'no choice given' using errcode='22023', detail='choice_invalid';
  end if;
  -- One save at a time per account, then the member check again after the wait.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 1707));
  perform internal.price_draft_actor();
  current_choices:=internal.communication_choices_dto(actor);
  wanted:=jsonb_strip_nulls(jsonb_build_object('marketing_email', p_marketing_email,
    'marketing_sms', p_marketing_sms, 'analytics', p_analytics, 'third_party_sharing', p_third_party_sharing));
  select count(*) into changes from jsonb_each(wanted) w where w.value is distinct from current_choices -> w.key;
  if changes > 0 then
    select count(*) into recent from private.communication_choice_events e
      where e.account_id = actor and e.recorded_at > statement_timestamp() - interval '24 hours';
    if recent + changes > 40 then
      raise exception 'too many changes today; try again tomorrow' using errcode='PT429', detail='choice_limit';
    end if;
    insert into private.communication_choice_events (account_id, purpose, granted, wording_version)
      select actor, w.key, w.value::boolean, p_wording from jsonb_each(wanted) w
      where w.value is distinct from current_choices -> w.key
      order by w.key;
  end if;
  return internal.communication_choices_dto(actor);
end;
$function$;
alter function internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) owner to postgres;
revoke all on function internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.save_my_communication_choices(p_wording text, p_marketing_email boolean DEFAULT NULL::boolean, p_marketing_sms boolean DEFAULT NULL::boolean, p_analytics boolean DEFAULT NULL::boolean, p_third_party_sharing boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_my_communication_choices(p_wording, p_marketing_email, p_marketing_sms, p_analytics, p_third_party_sharing);
$function$;
alter function api.save_my_communication_choices(text,boolean,boolean,boolean,boolean) owner to postgres;
revoke all on function api.save_my_communication_choices(text,boolean,boolean,boolean,boolean) from public, anon, authenticated, service_role;
grant execute on function api.save_my_communication_choices(text,boolean,boolean,boolean,boolean) to authenticated;

-- 3. Finished account emails of the caller: sent, or failed for good (the
-- email job stops after 8 attempts). Nothing that identifies a recipient,
-- record or provider error leaves the database.
CREATE OR REPLACE FUNCTION internal.list_my_email_history(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); items jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid limit' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'at', x.at)
      order by x.created_at desc, x.id), '[]'::jsonb)
    into items
  from (select o.id, o.kind, o.created_at,
      case when o.processed_at is not null then 'sent' else 'failed' end as status,
      coalesce(o.processed_at, o.created_at) as at
    from private.outbox_events o
    where o.owner_id = actor and (o.processed_at is not null or o.delivery_attempts >= 8)
    order by o.created_at desc, o.id
    limit p_limit) x;
  return jsonb_build_object('items', items);
end;
$function$;
alter function internal.list_my_email_history(integer) owner to postgres;
revoke all on function internal.list_my_email_history(integer) from public, anon, authenticated, service_role;
grant execute on function internal.list_my_email_history(integer) to authenticated;

CREATE OR REPLACE FUNCTION api.list_my_email_history(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_my_email_history(p_limit);
$function$;
alter function api.list_my_email_history(integer) owner to postgres;
revoke all on function api.list_my_email_history(integer) from public, anon, authenticated, service_role;
grant execute on function api.list_my_email_history(integer) to authenticated;

-- 4. Record the current Terms when an Auth user is created. Sign-up details
-- are written by the member or the sign-in provider: terms_accepted only says
-- the member ticked the box, which is all it may say. The version is always
-- the current one, read here, never taken from the details.
CREATE OR REPLACE FUNCTION internal.record_signup_terms()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare how text;
begin
  if new.is_anonymous then return new; end if;
  if new.raw_app_meta_data ->> 'provider' = 'google' then how:='google';
  elsif new.raw_user_meta_data -> 'terms_accepted' = 'true'::jsonb then how:='email_form';
  else return new;
  end if;
  insert into private.signup_terms_acceptances (account_id, version, document_hash, method)
    select new.id, v.version, v.document_hash, how
    from private.posting_terms_current c join private.posting_terms_versions v on v.version = c.version
    where c.singleton
    on conflict (account_id) do nothing;
  return new;
end;
$function$;
alter function internal.record_signup_terms() owner to postgres;
revoke all on function internal.record_signup_terms() from public, anon, authenticated, service_role;
drop trigger if exists record_signup_terms on auth.users;
create trigger record_signup_terms after insert on auth.users
  for each row execute function internal.record_signup_terms();

commit;
