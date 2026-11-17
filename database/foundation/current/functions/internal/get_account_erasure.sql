-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_account_erasure(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare linked private.account_erasure_requests; subject uuid;
begin
  perform internal.staff_actor('dsar:manage');
  if p_request is null then raise exception 'privacy request required' using errcode = '22023'; end if;
  select * into linked from private.account_erasure_requests l where l.request_id = p_request;
  if found then
    return jsonb_build_object('request_id', p_request, 'linked', linked.linked_how, 'linked_at', linked.linked_at)
      || internal.account_erasure_state(linked.user_id);
  end if;
  select x.subject_user_id into subject from private.privacy_requests x where x.id = p_request and x.type = 'deletion';
  if not found then raise exception 'deletion request not found' using errcode = 'PT404', detail = 'request_unavailable'; end if;
  return jsonb_build_object('request_id', p_request, 'linked', null,
    'status', case when subject is null then 'no_account' else 'not_ordered' end);
end;
$function$;
alter function internal.get_account_erasure(uuid) owner to postgres;
revoke all on function internal.get_account_erasure(uuid) from public;
grant execute on function internal.get_account_erasure(uuid) to authenticated;
