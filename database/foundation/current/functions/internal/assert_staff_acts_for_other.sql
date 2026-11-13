-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assert_staff_acts_for_other(p_actor uuid, p_subject uuid, p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if internal.individual_slot_identity(p_actor) is null then
    raise exception 'staff need an accepted ID review of their own for this' using errcode='42501';
  end if;
  if internal.same_identity(p_actor, p_subject) then
    if p_kind='limit' then
      raise exception 'a different staff member must change this limit' using errcode='42501';
    end if;
    raise exception 'a different staff member must record this reversal' using errcode='42501';
  end if;
end;
$function$;
alter function internal.assert_staff_acts_for_other(uuid,uuid,text) owner to postgres;
revoke all on function internal.assert_staff_acts_for_other(uuid,uuid,text) from public;
