-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.switch_frontend_cipc_representative(p_business uuid, p_case uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();x private.frontend_business_checks;
begin
  x:=internal.lock_frontend_cipc_case(p_case);actor:=internal.price_draft_actor();
  if actor<>x.owner_id or x.business_id<>p_business or x.kind<>'cipc' then raise exception 'owner CIPC case unavailable' using errcode='PT404';end if;
  update private.frontend_cipc_reviews set route='representative' where check_id=x.id and route='director' and submitted_at is not null;
  if not found then raise exception 'no open director request to switch' using errcode='PT409';end if;
  update private.frontend_business_checks set status='pending',updated_at=clock_timestamp() where id=x.id;
  perform internal.price_draft_actor();return jsonb_build_object('ok',true);
end$function$;
alter function internal.switch_frontend_cipc_representative(uuid,uuid) owner to postgres;
revoke all on function internal.switch_frontend_cipc_representative(uuid,uuid) from public;
grant execute on function internal.switch_frontend_cipc_representative(uuid,uuid) to authenticated;
