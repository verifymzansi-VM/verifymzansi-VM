-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_free_credits()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform internal.staff_actor('free_credit:view');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'member', case when u.email is null then null else internal.mask_email(u.email) end,
        'posts', e.slot_capacity,
        'starts_at', e.starts_at,
        'ends_at', e.ends_at,
        'status', case when e.status='active' and e.ends_at>statement_timestamp() then 'active' else 'ended' end,
        'views', (select coalesce(sum(t.views), 0)::bigint from private.post_engagement_totals t
          where t.post_id in (select a.post_id from private.post_activations a
            where a.entitlement_id=e.id and a.post_id is not null)))
      order by e.starts_at desc, e.id)
    from (select x.* from private.entitlements x where x.source='free_credit'
      order by x.starts_at desc, x.id limit 500) e
    left join auth.users u on u.id=e.owner_id), '[]'::jsonb));
end;
$function$;
alter function internal.list_free_credits() owner to postgres;
revoke all on function internal.list_free_credits() from public;
grant execute on function internal.list_free_credits() to authenticated;
