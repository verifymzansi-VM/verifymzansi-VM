-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.end_house_slot(p_entitlement uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare v_ends timestamptz; v_locked uuid[]; v_post_ids uuid[];
begin
  if p_entitlement is null or not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'house slot and reason required' using errcode='22023';
  end if;
  update private.entitlements e set status='revoked', revoked_reason='house_slot_ended'
    where e.id=p_entitlement and e.source='staff_grant' and e.status<>'revoked'
      and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)
    returning e.ends_at into v_ends;
  if found then
    insert into private.house_slot_events(entitlement_id, action, ends_at, approved_by, reason)
      values(p_entitlement, 'ended', v_ends, null, p_reason);
  elsif not exists(select 1 from private.entitlements e where e.id=p_entitlement and e.source='staff_grant'
      and e.status='revoked' and e.revoked_reason='house_slot_ended') then
    return 0;
  end if;
  select coalesce(array_agg(x.id), '{}') into v_locked from (select p.id from private.posts p
      where p.id in(select a.post_id from private.post_activations a
        where a.entitlement_id=p_entitlement and a.released_at is null)
      order by p.id for no key update of p skip locked) x;
  with released as (
    update private.post_activations a set released_at=statement_timestamp(), release_reason='entitlement_ended'
    where a.entitlement_id=p_entitlement and a.released_at is null and a.post_id=any(v_locked) returning a.post_id)
  select coalesce(array_agg(post_id), '{}') into v_post_ids from released;
  update private.posts p set status='expired', status_reason='Slot ended', revision=revision+1
    where p.id=any(v_post_ids) and (p.status in('live','pending_moderation')
      or (p.status='paused' and not exists(select 1 from private.frontend_content_holds h
        where h.post_id=p.id and h.released_at is null)));
  update private.post_search_documents set is_visible=false where post_id=any(v_post_ids);
  return cardinality(v_post_ids);
end;
$function$;
alter function internal.end_house_slot(uuid,text) owner to postgres;
revoke all on function internal.end_house_slot(uuid,text) from public;
