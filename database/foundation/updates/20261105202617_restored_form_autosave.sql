-- The selected creation wizards keep one short-lived autosave per flow.
-- Autosaves are owner-only form data; they neither create nor publish a post.
begin;
set local lock_timeout='5s';
create table private.frontend_form_drafts(
  owner_id uuid not null references auth.users(id) on delete cascade,
  flow text not null check(flow in('listing','business','promotion')),
  step integer not null check(step>=0),
  data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=65536),
  saved_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>saved_at),
  primary key(owner_id,flow)
);
create index frontend_form_drafts_expiry_idx on private.frontend_form_drafts(expires_at,owner_id,flow);
alter table private.frontend_form_drafts enable row level security;
revoke all on private.frontend_form_drafts from public,anon,authenticated,service_role;

create function internal.clear_closed_account_form_drafts()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  delete from private.frontend_form_drafts where owner_id=new.user_id;
  return null;
end$$;
revoke all on function internal.clear_closed_account_form_drafts() from public,anon,authenticated,service_role;
create trigger frontend_form_drafts_account_closed after insert on private.account_closures
  for each row execute function internal.clear_closed_account_form_drafts();

create function internal.frontend_form_draft(p_flow text,p_action text,p_step integer default null,p_data jsonb default null,p_expected_account uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();stamp timestamptz;draft jsonb;
begin
  if p_expected_account is not null and p_expected_account<>actor
    then raise exception 'draft account changed' using errcode='42501';end if;
  if p_flow is null or p_flow not in('listing','business','promotion') or p_action is null or p_action not in('read','save','discard')
    then raise exception 'valid draft flow and action required' using errcode='22023';end if;
  if p_action='read' then
    select jsonb_build_object('step',d.step,'data',d.data,'saved_at',d.saved_at) into draft
      from private.frontend_form_drafts d where d.owner_id=actor and d.flow=p_flow and d.expires_at>clock_timestamp();
    perform internal.price_draft_actor();
    return jsonb_build_object('draft',draft);
  end if;
  perform internal.lock_evidence_subject(actor);
  perform internal.price_draft_actor();
  if p_action='discard' then
    delete from private.frontend_form_drafts where owner_id=actor and flow=p_flow;
  else
    if p_step is null or p_step<0 or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>65536
      then raise exception 'valid draft data required' using errcode='22023';end if;
    stamp:=clock_timestamp();
    insert into private.frontend_form_drafts(owner_id,flow,step,data,saved_at,expires_at)
      values(actor,p_flow,p_step,p_data,stamp,stamp+interval '14 days')
      on conflict(owner_id,flow) do update set step=excluded.step,data=excluded.data,
        saved_at=excluded.saved_at,expires_at=excluded.expires_at;
  end if;
  perform internal.price_draft_actor();
  return jsonb_build_object('ok',true);
end$$;
create function api.frontend_form_draft(p_flow text,p_action text,p_step integer default null,p_data jsonb default null,p_expected_account uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.frontend_form_draft(p_flow,p_action,p_step,p_data,p_expected_account)
$$;
revoke all on function internal.frontend_form_draft(text,text,integer,jsonb,uuid),api.frontend_form_draft(text,text,integer,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.frontend_form_draft(text,text,integer,jsonb,uuid),api.frontend_form_draft(text,text,integer,jsonb,uuid) to authenticated;

create function internal.purge_frontend_form_drafts(p_limit integer)
returns integer language plpgsql security definer set search_path=pg_catalog as $$
declare deleted integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'bounded draft cleanup required' using errcode='22023';end if;
  with due as (select d.owner_id,d.flow from private.frontend_form_drafts d
    where d.expires_at<=statement_timestamp() order by d.expires_at,d.owner_id,d.flow limit p_limit for update skip locked)
  delete from private.frontend_form_drafts d using due where d.owner_id=due.owner_id and d.flow=due.flow;
  get diagnostics deleted=row_count;
  return deleted;
end$$;
create function api.purge_frontend_form_drafts(p_limit integer)
returns integer language sql security invoker set search_path=pg_catalog as $$
  select internal.purge_frontend_form_drafts(p_limit)
$$;
revoke all on function internal.purge_frontend_form_drafts(integer),api.purge_frontend_form_drafts(integer) from public,anon,authenticated,service_role;
grant execute on function internal.purge_frontend_form_drafts(integer),api.purge_frontend_form_drafts(integer) to service_role;

notify pgrst,'reload schema';
commit;
