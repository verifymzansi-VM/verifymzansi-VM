-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_check_summary(k private.identity_checks)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('id',k.id,
    'status',case when k.status='started' and k.expires_at<=statement_timestamp() then 'not_finished' else k.status end,
    'created_at',k.created_at,'expires_at',k.expires_at,'finished_at',k.finished_at,
    'session_id',case when k.status='started' and k.expires_at>statement_timestamp() then k.session_id end,
    'session_url',case when k.status='started' and k.expires_at>statement_timestamp() then k.session_url end,
    'declined_at',k.declined_at,'ask_person_until',k.declined_at+interval '5 days',
    'can_ask_person',internal.identity_check_askable(k),
    'asked_person',(select jsonb_build_object('status',a.status,'created_at',a.created_at,'resolved_at',a.resolved_at)
      from private.frontend_appeals a where a.action_id=k.id and a.kind='identity_check'));
$function$;
alter function internal.identity_check_summary(private.identity_checks) owner to postgres;
revoke all on function internal.identity_check_summary(private.identity_checks) from public;
