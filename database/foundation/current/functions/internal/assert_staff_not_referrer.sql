-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assert_staff_not_referrer(p_actor uuid, p_customer uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if exists(select 1 from private.account_acquisitions a join private.partners p on p.id = a.partner_id
      where a.account_id = p_customer and internal.same_identity(p_actor, p.account_id)) then
    raise exception 'a different staff member must handle a payment of a customer you referred'
      using errcode='42501', detail='staff_referred_customer';
  end if;
end;
$function$;
alter function internal.assert_staff_not_referrer(uuid,uuid) owner to postgres;
revoke all on function internal.assert_staff_not_referrer(uuid,uuid) from public;
