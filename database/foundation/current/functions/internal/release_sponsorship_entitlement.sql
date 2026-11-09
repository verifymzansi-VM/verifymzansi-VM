-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.release_sponsorship_entitlement(p_entitlement uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare v_post_ids uuid[];
begin
  if p_entitlement is null then return 0; end if;
  perform p.id from private.posts p where p.id in(select a.post_id from private.post_activations a
    where a.entitlement_id=p_entitlement and a.released_at is null) order by p.id for update of p nowait;
  perform e.id from private.entitlements e where e.id=p_entitlement for update nowait;
  -- Re-read after the entitlement lock: an activation may have committed
  -- since the first post scan. Never wait on a newly discovered post here.
  perform p.id from private.posts p where p.id in(select a.post_id from private.post_activations a
    where a.entitlement_id=p_entitlement and a.released_at is null) order by p.id for update of p nowait;
  update private.entitlements set status='revoked',revoked_reason='sponsorship_ended'
    where id=p_entitlement and status<>'revoked';
  with released as (
    update private.post_activations a set released_at=statement_timestamp(),release_reason='entitlement_ended'
    where a.entitlement_id=p_entitlement and a.released_at is null returning a.post_id)
  select coalesce(array_agg(post_id) filter(where post_id is not null),'{}') into v_post_ids from released;
  update private.posts p set status='expired',status_reason='Sponsorship ended',revision=revision+1
    where p.id=any(v_post_ids) and (p.status in('live','pending_moderation')
      or (p.status='paused' and not exists(select 1 from private.frontend_content_holds h
        where h.post_id=p.id and h.released_at is null)));
  update private.post_search_documents set is_visible=false where post_id=any(v_post_ids);
  return cardinality(v_post_ids);
exception when lock_not_available then
  raise exception 'sponsorship is busy; retry the operation' using errcode='PT409',detail='sponsorship_busy';
end;
$function$;
alter function internal.release_sponsorship_entitlement(uuid) owner to postgres;
revoke all on function internal.release_sponsorship_entitlement(uuid) from public;
