-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_communication_choices()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.consent_actor();
begin
  return internal.communication_choices_dto(actor);
end;
$function$;
alter function internal.get_my_communication_choices() owner to postgres;
revoke all on function internal.get_my_communication_choices() from public;
grant execute on function internal.get_my_communication_choices() to authenticated;
