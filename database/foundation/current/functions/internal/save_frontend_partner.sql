-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_frontend_partner(p_account uuid, p_action text, p_reason text, p_code text DEFAULT NULL::text, p_rate integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('partner:manage');note_text text;result jsonb;
begin
  if p_note is not null then note_text:=internal.privacy_text(p_note,1,1000);end if;
  result:=internal.staff_save_partner(p_account,p_action,upper(p_code),p_rate,p_reason);
  if note_text is not null then
    insert into private.frontend_partner_notes(partner_id,actor_id,note) values((result->>'id')::uuid,actor,note_text);
  end if;
  perform internal.staff_actor('partner:manage');return result;
end$function$;
alter function internal.save_frontend_partner(uuid,text,text,text,integer,text) owner to postgres;
revoke all on function internal.save_frontend_partner(uuid,text,text,text,integer,text) from public;
grant execute on function internal.save_frontend_partner(uuid,text,text,text,integer,text) to authenticated;
