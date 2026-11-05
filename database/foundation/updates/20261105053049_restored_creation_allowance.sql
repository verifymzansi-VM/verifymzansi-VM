-- Keep slot usage intact for the plan display. Expose how many additional
-- activations can actually fit through both limits of each usable entitlement.
begin;
do $$declare original text;body text;begin
  select replace(prosrc,E'\r\n',E'\n') into original from pg_proc where oid='internal.get_my_frontend_posting_allowance(text)'::regprocedure;
  if md5(original)<>'19d54312c05833a2403231868a41f3eb' then raise exception 'posting allowance contract drift';end if;
  body:=replace(original,'    ''max_photos'',coalesce(max(u.max_photos),case when eligible then 10 else 0 end),',
    '    ''creation_remaining'',coalesce(sum(greatest(0,least(u.slot_capacity-a.active_count,
        coalesce(u.activations_per_period-a.period_count,u.slot_capacity)))),0),
    ''max_photos'',coalesce(max(u.max_photos),case when eligible then 10 else 0 end),');
  if body=original then raise exception 'creation allowance projection anchor missing';end if;
  original:=body;
  body:=replace(body,'into result from usable u;',
    'into result from usable u cross join lateral (
      select count(*) filter(where x.released_at is null) as active_count,
        count(*) filter(where x.activated_at>statement_timestamp()-make_interval(days=>u.activation_period_days)) as period_count
      from private.post_activations x where x.entitlement_id=u.id
    ) a;');
  if body=original then raise exception 'creation allowance count anchor missing';end if;
  execute format('create function internal.get_my_frontend_posting_allowance_v2(p_area text) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',body);
end$$;
revoke all on function internal.get_my_frontend_posting_allowance_v2(text) from public,anon,authenticated,service_role;
grant execute on function internal.get_my_frontend_posting_allowance_v2(text) to authenticated;
create function api.get_my_frontend_posting_allowance_v2(p_area text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_my_frontend_posting_allowance_v2(p_area)$$;
revoke all on function api.get_my_frontend_posting_allowance_v2(text) from public,anon,authenticated,service_role;
grant execute on function api.get_my_frontend_posting_allowance_v2(text) to authenticated;
notify pgrst,'reload schema';
commit;
