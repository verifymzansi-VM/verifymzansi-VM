-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_frontend_privacy_intake(p_type text, p_email text, p_phone text, p_description text, p_note text, p_received timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');rule private.privacy_request_rules;r private.privacy_requests;
  now_at timestamptz:=clock_timestamp();received timestamptz:=coalesce(p_received,now_at);email text:=lower(btrim(p_email));
begin
  if email is null or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or not isfinite(received) or received>now_at+interval '1 minute' or received<now_at-interval '60 days'
    then raise exception 'check recipient and received date' using errcode='22023';end if;
  select * into rule from private.privacy_request_rules where request_type=p_type;
  if not found then raise exception 'unknown privacy request type' using errcode='22023';end if;
  insert into private.privacy_requests(type,requester_email,requester_phone,description,identity_check,received_at,due_by,legal_basis,intake_by)
    values(p_type,email,coalesce(nullif(btrim(p_phone),''),'not_provided'),
      internal.privacy_text(p_description,10,2000)||E'\n\nIntake note: '||internal.privacy_text(p_note,10,1000),
      'manual',received,received+make_interval(days=>rule.days),rule.source,actor) returning * into r;
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision) values(r.id,actor,'recorded',1);
  perform internal.staff_actor('dsar:manage');
  return jsonb_build_object('id',r.id,'due_by',r.due_by);
end$function$;
alter function internal.record_frontend_privacy_intake(text,text,text,text,text,timestamp with time zone) owner to postgres;
revoke all on function internal.record_frontend_privacy_intake(text,text,text,text,text,timestamp with time zone) from public;
grant execute on function internal.record_frontend_privacy_intake(text,text,text,text,text,timestamp with time zone) to authenticated;
