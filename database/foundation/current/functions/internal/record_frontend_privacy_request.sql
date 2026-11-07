-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_frontend_privacy_request(p_account uuid, p_session uuid, p_type text, p_name text, p_last_four text, p_details text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare confirmed_email text;request_text text;rule private.privacy_request_rules;r private.privacy_requests;now_at timestamptz;
begin
  if p_last_four is not null and p_last_four !~ '^[0-9]{4}$' then raise exception 'masked identifier suffix required' using errcode='22023';end if;
  request_text:='Name: '||internal.privacy_text(p_name,2,120)
    ||case when p_last_four is not null then E'\nID ending: '||p_last_four else '' end
    ||case when p_details is not null then E'\n'||internal.privacy_text(p_details,1,2000) else '' end;
  select * into rule from private.privacy_request_rules where request_type=p_type;
  if not found then raise exception 'unknown privacy request type' using errcode='22023';end if;
  perform internal.lock_verification_subject(p_account);
  select u.email into confirmed_email from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=p_account and s.id=p_session and (s.not_after is null or s.not_after>clock_timestamp())
      and u.email_confirmed_at is not null and u.email is not null and not u.is_anonymous and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and not exists(select 1 from private.account_closures c where c.user_id=u.id);
  if not found then raise exception 'live confirmed account session required' using errcode='42501';end if;
  now_at:=clock_timestamp();
  select * into r from private.privacy_requests x where x.subject_user_id=p_account and x.type=p_type and x.identity_check='session'
    and x.description=request_text and x.requester_email=confirmed_email and x.created_at>now_at-interval '10 minutes' order by x.created_at desc limit 1;
  if found then return jsonb_build_object('id',r.id,'due_by',r.due_by,'reused',true);end if;
  if (select count(*) from private.privacy_requests x where x.subject_user_id=p_account and x.created_at>now_at-interval '1 hour')>=5
    then raise exception 'privacy request limit reached' using errcode='PT429';end if;
  insert into private.privacy_requests(type,subject_user_id,requester_email,description,identity_check,received_at,due_by,legal_basis)
    values(p_type,p_account,confirmed_email,request_text,'session',now_at,now_at+make_interval(days=>rule.days),rule.source) returning * into r;
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision) values(r.id,p_account,'submitted',1);
  insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'submitted');
  return jsonb_build_object('id',r.id,'due_by',r.due_by);
end$function$;
alter function internal.record_frontend_privacy_request(uuid,uuid,text,text,text,text) owner to postgres;
revoke all on function internal.record_frontend_privacy_request(uuid,uuid,text,text,text,text) from public;
grant execute on function internal.record_frontend_privacy_request(uuid,uuid,text,text,text,text) to service_role;
