-- Runtime controls for supported restored interfaces only. A display flag
-- never changes native authentication, MFA, verification or command authority.
begin;
insert into private.staff_capabilities(role,capability,requires_recent_mfa)
  values('admin','feature_flag:toggle',true);
create table private.frontend_feature_flags(
  id uuid primary key default gen_random_uuid(),
  key text not null unique check(key in('kyc_evidence_desk')),
  description text not null,
  mode text not null default 'off' check(mode in('off','on','percent','allowlist')),
  rollout_percent integer not null default 0 check(rollout_percent between 0 and 100),
  allowlist_roles text[] not null default '{}' check(cardinality(allowlist_roles)<=5 and allowlist_roles <@ array['admin','moderator','governance_controller','member','buyer']::text[]),
  revision integer not null default 1 check(revision>0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  updated_reason text
);
create index frontend_feature_flags_actor_idx on private.frontend_feature_flags(updated_by);
create table private.frontend_feature_flag_events(
  id uuid primary key default gen_random_uuid(),
  flag_id uuid not null references private.frontend_feature_flags(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  revision integer not null check(revision>1),
  mode text not null check(mode in('off','on','percent','allowlist')),
  rollout_percent integer not null check(rollout_percent between 0 and 100),
  allowlist_roles text[] not null,
  reason text not null check(length(reason) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(),
  unique(flag_id,revision)
);
create index frontend_feature_flag_events_actor_idx on private.frontend_feature_flag_events(actor_id);
alter table private.frontend_feature_flags enable row level security;
alter table private.frontend_feature_flag_events enable row level security;
revoke all on private.frontend_feature_flags,private.frontend_feature_flag_events from public,anon,authenticated,service_role;
insert into private.frontend_feature_flags(key,description) values('kyc_evidence_desk','Enable the admin evidence desk for side-by-side document review');

create function internal.read_frontend_feature_config()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('key',f.key,'enabled',f.mode<>'off','mode',f.mode,
    'rollout_percent',f.rollout_percent,'allowlist_roles',f.allowlist_roles) order by f.key),'[]'::jsonb) from private.frontend_feature_flags f;
$$;
revoke all on function internal.read_frontend_feature_config() from public,anon,authenticated,service_role;
grant execute on function internal.read_frontend_feature_config() to service_role;
create function api.read_frontend_feature_config() returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.read_frontend_feature_config()$$;
revoke all on function api.read_frontend_feature_config() from public,anon,authenticated,service_role;
grant execute on function api.read_frontend_feature_config() to service_role;

create function internal.get_frontend_feature_flags()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('feature_flag:toggle');rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'key',f.key,'enabled',f.mode<>'off','description',f.description,
    'mode',f.mode,'rollout_percent',f.rollout_percent,'allowlist_roles',f.allowlist_roles,'revision',f.revision,
    'updated_at',f.updated_at,'updated_reason',f.updated_reason) order by f.key),'[]'::jsonb) into rows from private.frontend_feature_flags f;
  perform internal.staff_actor('feature_flag:toggle');return jsonb_build_object('account_id',actor,'flags',rows);
end$$;
revoke all on function internal.get_frontend_feature_flags() from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_feature_flags() to authenticated;
create function api.get_frontend_feature_flags() returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_feature_flags()$$;
revoke all on function api.get_frontend_feature_flags() from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_feature_flags() to authenticated;

create function internal.set_frontend_feature_flag(p_key text,p_expected_revision integer,p_mode text,p_percent integer,p_roles text[],p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('feature_flag:toggle');f private.frontend_feature_flags;reason text;roles text[];
begin
  if p_expected_revision is null or p_expected_revision not between 1 and 2147483646 or p_mode is null or p_mode not in('off','on','percent','allowlist')
    or p_percent is null or p_percent not between 0 and 100 or p_roles is null or cardinality(p_roles)>5
    or exists(select 1 from unnest(p_roles) x where x is null or x not in('admin','moderator','governance_controller','member','buyer')) then
    raise exception 'valid represented feature configuration required' using errcode='22023';end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":1,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason is null or reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'valid change reason required' using errcode='22023';end if;
  select coalesce(array_agg(distinct x order by x),'{}'::text[]) into roles from unnest(p_roles) x;
  if p_mode<>'allowlist' then roles:='{}';end if;
  if p_mode<>'percent' then p_percent:=case p_mode when 'on' then 100 else 0 end;end if;
  select * into f from private.frontend_feature_flags where key=p_key for update;
  if not found then raise exception 'supported display flag required; security controls are not feature flags' using errcode='22023';end if;
  actor:=internal.staff_actor('feature_flag:toggle');
  if f.revision=p_expected_revision+1 and f.updated_by=actor and f.mode=p_mode and f.rollout_percent=p_percent
    and f.allowlist_roles=roles and f.updated_reason=reason then return internal.get_frontend_feature_flags();end if;
  if f.revision<>p_expected_revision then raise exception 'feature configuration changed; reload settings' using errcode='PT409';end if;
  update private.frontend_feature_flags set mode=p_mode,rollout_percent=p_percent,allowlist_roles=roles,
    revision=revision+1,updated_by=actor,updated_at=clock_timestamp(),updated_reason=reason where id=f.id;
  insert into private.frontend_feature_flag_events(flag_id,actor_id,revision,mode,rollout_percent,allowlist_roles,reason)
    values(f.id,actor,f.revision+1,p_mode,p_percent,roles,reason);
  perform internal.staff_actor('feature_flag:toggle');return internal.get_frontend_feature_flags();
end$$;
revoke all on function internal.set_frontend_feature_flag(text,integer,text,integer,text[],text) from public,anon,authenticated,service_role;
grant execute on function internal.set_frontend_feature_flag(text,integer,text,integer,text[],text) to authenticated;
create function api.set_frontend_feature_flag(p_key text,p_expected_revision integer,p_mode text,p_percent integer,p_roles text[],p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.set_frontend_feature_flag(p_key,p_expected_revision,p_mode,p_percent,p_roles,p_reason)$$;
revoke all on function api.set_frontend_feature_flag(text,integer,text,integer,text[],text) from public,anon,authenticated,service_role;
grant execute on function api.set_frontend_feature_flag(text,integer,text,integer,text[],text) to authenticated;

create function internal.get_frontend_governance_metrics()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('decision:approve');answer jsonb;
begin
  select jsonb_build_object('account_id',actor,'total',count(*),'approved',count(*) filter(where d.status='approved'),
    'rejected',count(*) filter(where d.status='withdrawn' and exists(select 1 from private.frontend_governance_events e where e.decision_id=d.id and e.action='reject')),
    'overridden',count(*) filter(where d.status='approved' and d.action='approve_override')) into answer from private.decisions d;
  perform internal.staff_actor('decision:approve');return answer;
end$$;
revoke all on function internal.get_frontend_governance_metrics() from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_governance_metrics() to authenticated;
create function api.get_frontend_governance_metrics() returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_governance_metrics()$$;
revoke all on function api.get_frontend_governance_metrics() from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_governance_metrics() to authenticated;
notify pgrst,'reload schema';
commit;
