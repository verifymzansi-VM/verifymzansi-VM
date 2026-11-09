-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_queue_claim(p_post_id uuid, p_report_id uuid)
 RETURNS private.queue_claims
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare c private.queue_claims;
begin
  select q.* into c from private.queue_claims q
    where (q.post_id = p_post_id or q.report_id = p_report_id) for update;
  return c;
end;
$function$;
alter function internal.lock_queue_claim(uuid,uuid) owner to postgres;
revoke all on function internal.lock_queue_claim(uuid,uuid) from public;
