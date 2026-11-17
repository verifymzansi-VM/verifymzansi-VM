-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_payment_digest(p_claim uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_claim is null then raise exception 'invalid payment summary claim' using errcode='22023'; end if;
  update private.payment_problem_digests set done_at=clock_timestamp(), claimed_until=null
    where claim=p_claim and done_at is null;
  return found;
end;
$function$;
alter function internal.complete_payment_digest(uuid) owner to postgres;
revoke all on function internal.complete_payment_digest(uuid) from public;
grant execute on function internal.complete_payment_digest(uuid) to service_role;
