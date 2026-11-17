-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.release_queue_claim(p_subject text, p_id uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('queue:claim'); s record;
begin
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  actor := internal.staff_actor('queue:claim');
  perform internal.consume_queue_claim(p_subject, p_id, actor, p_claim_generation, p_claim_nonce);
  perform internal.staff_actor('queue:claim'); -- authority after the claim-row wait
  return jsonb_build_object('subject', p_subject, 'id', p_id, 'status', 'released');
end;
$function$;
alter function internal.release_queue_claim(text,uuid,text,uuid) owner to postgres;
revoke all on function internal.release_queue_claim(text,uuid,text,uuid) from public;
grant execute on function internal.release_queue_claim(text,uuid,text,uuid) to authenticated;
