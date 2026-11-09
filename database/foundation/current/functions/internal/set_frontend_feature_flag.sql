-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.set_frontend_feature_flag(p_key text, p_expected_revision integer, p_mode text, p_percent integer, p_roles text[], p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.set_frontend_feature_flag(text,integer,text,integer,text[],text) owner to postgres;
revoke all on function internal.set_frontend_feature_flag(text,integer,text,integer,text[],text) from public;
grant execute on function internal.set_frontend_feature_flag(text,integer,text,integer,text[],text) to authenticated;
