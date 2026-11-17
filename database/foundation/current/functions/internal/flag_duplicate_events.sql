-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.flag_duplicate_events(p_post_a uuid, p_expected_revision_a integer, p_post_b uuid, p_expected_revision_b integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('event:flag_duplicate'); a uuid; b uuid;
  revision_a integer; revision_b integer; post_a private.posts; post_b private.posts;
  view_a jsonb; view_b jsonb; flag uuid; reason text;
begin
  if p_post_a is null or p_post_b is null or p_post_a=p_post_b then
    raise exception 'choose two different event posts' using errcode='22023';
  end if;
  if p_expected_revision_a is null or p_expected_revision_b is null
    or p_expected_revision_a<1 or p_expected_revision_b<1 then
    raise exception 'positive expected revisions required' using errcode='22023';
  end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":2000}'::jsonb,
    to_jsonb(p_reason)) #>> '{}';
  if reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode='22023';
  end if;
  a:=least(p_post_a,p_post_b); b:=greatest(p_post_a,p_post_b);
  revision_a:=case when a=p_post_a then p_expected_revision_a else p_expected_revision_b end;
  revision_b:=case when b=p_post_b then p_expected_revision_b else p_expected_revision_a end;
  perform internal.lock_duplicate_event_pair(a,b);
  actor:=internal.staff_actor('event:flag_duplicate');
  select * into post_a from private.posts p where p.id=a;
  select * into post_b from private.posts p where p.id=b;
  view_a:=internal.duplicate_public_event_view(a);
  view_b:=internal.duplicate_public_event_view(b);
  perform internal.staff_actor('event:flag_duplicate');
  if view_a is null or view_b is null then
    raise exception 'event pair is unavailable' using errcode='22023';
  end if;
  if post_a.owner_id=actor or post_b.owner_id=actor then
    raise exception 'you cannot flag your own event' using errcode='42501';
  end if;
  if post_a.revision<>revision_a or post_b.revision<>revision_b then
    raise exception 'event pair changed since review' using errcode='PT409',detail='event_pair_changed';
  end if;
  select r.id into flag from private.reports r where r.report_origin='staff'
    and r.status='open' and r.duplicate_post_a=a and r.duplicate_post_b=b;
  perform internal.staff_actor('event:flag_duplicate');
  if flag is not null then return jsonb_build_object('id',flag,'status','open','reused',true,'post_a',a,'post_b',b); end if;
  insert into private.reports(post_id,subject_account_id,category,description,reporter_id,reporter_ip_hmac,
    report_origin,duplicate_post_a,duplicate_post_b,duplicate_revision_a,duplicate_revision_b,
    duplicate_owner_b,duplicate_created_by)
  values(a,post_a.owner_id,'duplicate_event',reason,actor,null,'staff',a,b,revision_a,revision_b,post_b.owner_id,actor)
  returning id into flag;
  perform internal.staff_actor('event:flag_duplicate');
  view_a:=internal.duplicate_public_event_view(a);
  view_b:=internal.duplicate_public_event_view(b);
  perform internal.staff_actor('event:flag_duplicate');
  if view_a is null or view_b is null then
    raise exception 'event pair changed since review' using errcode='PT409',detail='event_pair_changed';
  end if;
  return jsonb_build_object('id',flag,'status','open','reused',false,'post_a',a,'post_b',b);
end;
$function$;
alter function internal.flag_duplicate_events(uuid,integer,uuid,integer,text) owner to postgres;
revoke all on function internal.flag_duplicate_events(uuid,integer,uuid,integer,text) from public;
grant execute on function internal.flag_duplicate_events(uuid,integer,uuid,integer,text) to authenticated;
