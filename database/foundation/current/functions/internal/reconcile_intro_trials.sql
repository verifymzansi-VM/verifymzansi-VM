-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reconcile_intro_trials(p_limit integer DEFAULT 20)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- The free week starts when the member's first post is approved
  -- (internal.start_intro_trial), not when verification completes.
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid limit' using errcode='22023'; end if;
  return 0;
end;
$function$;
alter function internal.reconcile_intro_trials(integer) owner to postgres;
revoke all on function internal.reconcile_intro_trials(integer) from public;
grant execute on function internal.reconcile_intro_trials(integer) to service_role;
