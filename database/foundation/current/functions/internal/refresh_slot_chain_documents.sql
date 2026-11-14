-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.refresh_slot_chain_documents(p_chain uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare changed integer;
begin
  update private.post_search_documents s set visible_until=d.until
  from (
    select p.id, internal.slot_chain_end(a.entitlement_id) as until
    from private.post_activations a
      join private.entitlements e on e.id=a.entitlement_id
      join private.posts p on p.id=a.post_id
    where a.released_at is null and (e.id=p_chain or e.slot_id=p_chain) and e.status='active'
      and p.kind<>'event' and p.edit_of is null and p.status in ('live','paused')
  ) d
  where s.post_id=d.id and d.until is not null and s.visible_until is distinct from d.until;
  get diagnostics changed=row_count;
  return changed;
end;
$function$;
alter function internal.refresh_slot_chain_documents(uuid) owner to postgres;
revoke all on function internal.refresh_slot_chain_documents(uuid) from public;
