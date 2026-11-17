-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.submit_frontend_report(p_post_id uuid, p_kind text, p_reason text, p_description text, p_reporter_ip_hmac text, p_reporter_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare post private.posts;category text;answer jsonb;
begin
  if p_kind is null or p_kind not in('listing','business','promotion') or p_reason is null or p_reason not in(
    'scam','misleading','expired','fake_listing','prohibited_item','harassment','impersonation','spam','other') then
    raise exception 'represented post kind and report reason required' using errcode='22023';end if;
  select * into post from private.posts where id=p_post_id for update;
  if not found or post.kind<>(case p_kind when 'promotion' then 'event' else p_kind end) then
    raise exception 'represented post is unavailable' using errcode='22023';end if;
  category:=case when p_reason in('scam','prohibited_item','impersonation','harassment') then p_reason else 'misleading_info' end;
  answer:=internal.submit_report(p_post_id,category,p_description,p_reporter_id,p_reporter_ip_hmac);
  update private.reports set frontend_reason=p_reason where id=(answer->>'id')::uuid;
  return answer;
end$function$;
alter function internal.submit_frontend_report(uuid,text,text,text,text,uuid) owner to postgres;
revoke all on function internal.submit_frontend_report(uuid,text,text,text,text,uuid) from public;
grant execute on function internal.submit_frontend_report(uuid,text,text,text,text,uuid) to service_role;
