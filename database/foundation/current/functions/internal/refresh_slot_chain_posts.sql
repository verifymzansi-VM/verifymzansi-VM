-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.refresh_slot_chain_posts(p_chain uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare changed integer;
begin
  -- Live and paused posts in any active period of the slot: a renewal moves
  -- their end to the end of the renewal; a revoked renewal moves it back. A
  -- post under a staff hold keeps its state (the hand-over sets it again).
  with due as (
    select p.id, internal.slot_chain_end(a.entitlement_id) as until
    from private.post_activations a
      join private.entitlements e on e.id=a.entitlement_id
      join private.posts p on p.id=a.post_id
    where a.released_at is null and (e.id=p_chain or e.slot_id=p_chain) and e.status='active'
      and p.kind<>'event' and p.edit_of is null and p.status in ('live','paused')
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
  ), moved as (
    update private.posts p set visible_until=d.until from due d
    where p.id=d.id and d.until is not null and p.visible_until is distinct from d.until
    returning p.id, p.visible_until
  )
  update private.post_search_documents s set visible_until=m.visible_until from moved m where s.post_id=m.id;
  get diagnostics changed=row_count;
  return changed;
end;
$function$;
alter function internal.refresh_slot_chain_posts(uuid) owner to postgres;
revoke all on function internal.refresh_slot_chain_posts(uuid) from public;
