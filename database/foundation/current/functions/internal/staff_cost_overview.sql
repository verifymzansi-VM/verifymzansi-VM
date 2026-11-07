-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_cost_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('cost:view');
begin
  return jsonb_build_object(
    'generated_at', statement_timestamp(),
    'lines', (select jsonb_agg(jsonb_build_object('metric', a.metric, 'label', a.label, 'unit', a.unit,
        'provider', a.provider, 'period', a.period, 'used', u.used::text,
        'free_quantity', a.free_quantity::text, 'measurement',a.measurement,'billing_scope',a.billing_scope,'source_url',a.source_url,
        'percent_of_free', case when a.free_quantity is not null and u.used is not null and a.verified_on is not null and a.billing_scope<>'unverified' and a.measurement='database_observation'
          then round(100 * u.used / a.free_quantity, 1) end,
        'level', case when u.used is null or a.measurement='provider_required' then 'check_provider'
          when a.free_quantity is null then 'allowance_unknown'
          when a.verified_on is null or a.billing_scope='unverified' then 'unverified_allowance'
          when a.measurement='estimate' then 'estimated_usage'
          when u.used >= a.free_quantity * 0.9 then 'critical'
          when u.used >= a.free_quantity * 0.7 then 'warning' else 'ok' end,
        'overage_note', a.overage_note, 'verified_on', a.verified_on) order by a.metric)
      from private.cost_allowances a left join internal.cost_usage() u on u.metric = a.metric),
    'drivers', jsonb_build_object(
      'accounts', (select count(*) from auth.users u where u.deleted_at is null),
      'new_accounts_this_month', (select count(*) from auth.users u
        where u.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC'),
      'posts_by_status', coalesce((select jsonb_object_agg(x.status, x.n) from
        (select p.status, count(*) as n from private.posts p group by p.status) x), '{}'),
      'live_posts', (select count(*) from private.posts p where p.status = 'live'),
      'uploads_last_30_days', (select count(*) from private.media_objects m
        where m.created_at > statement_timestamp() - interval '30 days'),
      'average_bytes_per_live_post', (select coalesce(round(avg(t.bytes)), 0)::text from (
        select coalesce(sum(x.bytes),0) as bytes from private.posts p left join (
          select distinct pm.post_id,m.id,greatest(coalesce(m.size_bytes,0),m.declared_bytes) as bytes
          from private.post_media pm join private.media_objects m on m.id=pm.object_id
        ) x on x.post_id=p.id where p.status='live' group by p.id) t),
      'unused_media_bytes_awaiting_cleanup', (select coalesce(sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes)), 0)::text
        from private.media_objects m where m.state in ('intent', 'rejected', 'cleanup_required')),
      'expired_posts_awaiting_deletion', (select count(*) from private.posts p where p.status in ('expired', 'sold', 'archived')),
      'evidence_files', (select count(*) from private.evidence_artifacts a where a.state <> 'deleted')),
    'largest_storage_accounts', coalesce((select jsonb_agg(jsonb_build_object('account_id',t.account_id,'bytes',t.bytes::text,'live_posts',t.live_posts,'package_posts',t.package_posts) order by t.bytes desc) from (
        select m.owner_id as account_id, sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes))::bigint as bytes,
          (select count(*) from private.posts p where p.owner_id = m.owner_id and p.status = 'live') as live_posts,
          (select c.posts from internal.package_capacity(m.owner_id) c) as package_posts
        from (
          select owner_id,greatest(coalesce(size_bytes,0),declared_bytes) as declared_bytes,size_bytes
          from private.media_objects where state<>'deleted'
          union all
          select owner_id,coalesce(size_bytes,0),size_bytes from private.evidence_artifacts where state<>'deleted'
        ) m group by m.owner_id order by 2 desc,m.owner_id limit 10) t), '[]'),
    'open_alarms', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'metric', c.metric, 'level', c.level,
        'period', c.period, 'used', c.used::text, 'free_quantity', c.free_quantity::text, 'raised_at', c.raised_at)
        order by c.raised_at desc)
      from private.cost_alarms c where c.acknowledged_at is null), '[]'));
end;
$function$;
alter function internal.staff_cost_overview() owner to postgres;
revoke all on function internal.staff_cost_overview() from public;
grant execute on function internal.staff_cost_overview() to authenticated;
