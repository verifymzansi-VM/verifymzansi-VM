-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.my_queue_claims()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('queue:claim');
begin
  return coalesce((select jsonb_agg(internal.queue_claim_view(q) order by q.claim_expires_at, q.id)
    from private.queue_claims q where q.claimed_by = actor and q.claim_expires_at > clock_timestamp()), '[]'::jsonb);
end;
$function$;
alter function internal.my_queue_claims() owner to postgres;
revoke all on function internal.my_queue_claims() from public;
grant execute on function internal.my_queue_claims() to authenticated;
