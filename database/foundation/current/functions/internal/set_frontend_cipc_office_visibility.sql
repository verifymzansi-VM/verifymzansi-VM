-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.set_frontend_cipc_office_visibility(p_business uuid, p_show boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();sticker uuid;
begin
  if p_show is null then raise exception 'choose whether to show the full office' using errcode='22023';end if;
  perform internal.lock_verification_subject(actor);actor:=internal.price_draft_actor();
  select id into sticker from private.frontend_current_cipc_stickers s where s.business_id=p_business and s.owner_id=actor;
  if sticker is null then raise exception 'current verified registration required' using errcode='PT409';end if;
  update private.frontend_cipc_reviews set display_full_office=p_show where check_id=sticker;
  perform internal.price_draft_actor();return jsonb_build_object('showFull',p_show);
end$function$;
alter function internal.set_frontend_cipc_office_visibility(uuid,boolean) owner to postgres;
revoke all on function internal.set_frontend_cipc_office_visibility(uuid,boolean) from public;
grant execute on function internal.set_frontend_cipc_office_visibility(uuid,boolean) to authenticated;
