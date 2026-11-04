-- Retain the selected report reason and complete validated description;
-- enforce its represented post kind within the native submission transaction.
begin;
alter table private.reports add column frontend_reason text check(frontend_reason is null or frontend_reason in(
  'scam','misleading','expired','fake_listing','prohibited_item','harassment','impersonation','spam','other'));
create function internal.submit_frontend_report(p_post_id uuid,p_kind text,p_reason text,p_description text,p_reporter_ip_hmac text,p_reporter_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
end$$;
revoke all on function internal.submit_frontend_report(uuid,text,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.submit_frontend_report(uuid,text,text,text,text,uuid) to service_role;
create function api.submit_frontend_report(p_post_id uuid,p_kind text,p_reason text,p_description text,p_reporter_ip_hmac text,p_reporter_id uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.submit_frontend_report(p_post_id,p_kind,p_reason,p_description,p_reporter_ip_hmac,p_reporter_id)$$;
revoke all on function api.submit_frontend_report(uuid,text,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function api.submit_frontend_report(uuid,text,text,text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
