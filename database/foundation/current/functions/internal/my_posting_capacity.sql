-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.my_posting_capacity()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- The disposable prototype installs current account authority next. The clean
  -- baseline must create authority relations before dependent API functions.
  return (
  with actor as (select internal.price_draft_actor() as id),
  usable as (
    select e.* from private.entitlements e, actor
    where internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
      and (e.owner_id = actor.id or exists (select 1 from private.entitlement_members m
        where m.entitlement_id = e.id and m.member_id = actor.id))
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
        where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'))
  )
  select jsonb_build_object(
    'capacity', coalesce(sum(u.slot_capacity), 0),
    'active', (select count(*) from private.post_activations a where a.released_at is null
      and a.entitlement_id in (select id from usable)),
    'ends_at', max(u.ends_at),
    'sources', coalesce(jsonb_agg(distinct u.source) filter (where u.source is not null), '[]'))
  from usable u);
end;
$function$;
alter function internal.my_posting_capacity() owner to postgres;
revoke all on function internal.my_posting_capacity() from public;
grant execute on function internal.my_posting_capacity() to authenticated;
