-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assert_staff_payment_actor(p_actor uuid, p_subject uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if internal.current_verified_identity(p_actor) is null then
    raise exception 'staff need a current accepted ID review of their own for this' using errcode='42501', detail='staff_review_required';
  end if;
  if internal.same_identity(p_actor, p_subject) then
    raise exception 'a different staff member must handle this payment' using errcode='42501', detail='staff_same_identity';
  end if;
end;
$function$;
alter function internal.assert_staff_payment_actor(uuid,uuid) owner to postgres;
revoke all on function internal.assert_staff_payment_actor(uuid,uuid) from public;
