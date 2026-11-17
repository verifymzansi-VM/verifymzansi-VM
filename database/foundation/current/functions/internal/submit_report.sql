-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.submit_report(p_post_id uuid, p_category text, p_description text, p_reporter_id uuid, p_reporter_ip_hmac text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare subject uuid; body text; report_id uuid;
begin
  if p_category is null or p_category not in ('scam', 'prohibited_item', 'impersonation', 'harassment', 'misleading_info') then
    raise exception 'choose a report reason' using errcode = '22023';
  end if;
  if p_reporter_ip_hmac is null or p_reporter_ip_hmac !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'reporter fingerprint required' using errcode = '22023';
  end if;
  body := internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":2000}'::jsonb,
    to_jsonb(p_description)) #>> '{}';
  if body ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode = '22023';
  end if;
  if p_reporter_id is not null and not exists (select 1 from private.current_account_access u where u.id = p_reporter_id) then
    raise exception 'reporter account is not active' using errcode = '42501';
  end if;
  select p.owner_id into subject from private.posts p
    where p.id = p_post_id and exists (select 1 from private.public_eligible_posts e where e.id = p.id);
  if subject is null then raise exception 'post not found' using errcode = '22023'; end if;
  if subject = p_reporter_id then raise exception 'you cannot report your own post' using errcode = '22023'; end if;
  begin
    insert into private.reports (post_id, subject_account_id, category, description, reporter_id, reporter_ip_hmac)
    values (p_post_id, subject, p_category, body, p_reporter_id, p_reporter_ip_hmac)
    returning id into report_id;
  exception when unique_violation then
    raise exception 'you already reported this post' using errcode = 'PT409';
  end;
  return jsonb_build_object('id', report_id, 'status', 'open');
end;
$function$;
alter function internal.submit_report(uuid,text,text,uuid,text) owner to postgres;
revoke all on function internal.submit_report(uuid,text,text,uuid,text) from public;
grant execute on function internal.submit_report(uuid,text,text,uuid,text) to service_role;
