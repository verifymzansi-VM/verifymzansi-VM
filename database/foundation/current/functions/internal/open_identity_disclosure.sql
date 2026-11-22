-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.open_identity_disclosure(p_request_type text, p_reference text, p_reason text, p_lookup_kind text, p_lookup_value text, p_attested boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Rule D9 needs who issued the request, the official number called and who
  -- confirmed it; this earlier command carries none of them.
  return internal.open_authority_request(p_request_type,p_reference,null,null,null,
    p_reason,p_lookup_kind,p_lookup_value,p_attested);
end;
$function$;
alter function internal.open_identity_disclosure(text,text,text,text,text,boolean) owner to postgres;
revoke all on function internal.open_identity_disclosure(text,text,text,text,text,boolean) from public;
grant execute on function internal.open_identity_disclosure(text,text,text,text,text,boolean) to authenticated;
