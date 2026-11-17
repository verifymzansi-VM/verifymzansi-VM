-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.account_erasure_state(p_user uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'status', case when e.auth_removed_at is not null then 'removed'
      when e.erased_at is not null then 'erased'
      when e.blocked_reason is not null then 'held'
      else 'scheduled' end,
    'closed_at', e.closed_at, 'closed_by', e.closed_by, 'erase_after', e.erase_after, 'paid_until', e.paid_until,
    'erased_at', e.erased_at, 'erased', e.erased_counts, 'auth_removed_at', e.auth_removed_at,
    'held_by', case when e.erased_at is null then e.blocked_reason end,
    'held_at', case when e.erased_at is null then e.blocked_at end,
    'error_code', e.blocked_detail)
  from private.account_erasures e where e.user_id = p_user;
$function$;
alter function internal.account_erasure_state(uuid) owner to postgres;
revoke all on function internal.account_erasure_state(uuid) from public;
