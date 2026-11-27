-- Reviewed rollback for updates/20261127055550_reveal_business_contacts.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. The click-to-view route then
-- answers nothing for a business again (a deployed website that relies on it
-- shows "This contact option is unavailable" for business numbers), and the
-- public card read returns business_contacts again, without
-- business_contact_options (a deployed website then shows no business number
-- buttons).
-- It refuses (55000) unless internal.reveal_post_phone,
-- internal.frontend_post_presentation and internal.business_contact_number
-- have the update's bodies, then puts back the two earlier bodies byte for
-- byte (md5 98baceb9be415a5ba2150793263e58e1 and
-- 9f279565fc4eca46f6b355313a2271a3) and drops
-- internal.business_contact_number.
begin;
set local lock_timeout='5s';

do $$
declare r record;
begin
  for r in select v.sig,v.applied,
      (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) as body
    from (values
      ('internal.reveal_post_phone(uuid,text)','a30f22dd9c40c95cdc35abb9dcf5e204'),
      ('internal.frontend_post_presentation(uuid)','c679983dbb6c63714de6be71c459ee85'),
      ('internal.business_contact_number(jsonb,jsonb,text)','fd668f7973bcc89a2d139ab4e3d24af8')
    ) v(sig,applied) loop
    if r.body is distinct from r.applied then
      raise exception 'rollback precondition: the business contacts reveal update is not applied as reviewed (% %)',r.sig,coalesce(r.body,'absent')
        using errcode='55000';
    end if;
  end loop;
end$$;

CREATE OR REPLACE FUNCTION internal.reveal_post_phone(p_post_id uuid, p_channel text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare number text;
begin
  if p_channel is null or p_channel not in('call','whatsapp') then raise exception 'invalid channel' using errcode='22023'; end if;
  select f.phone into number from private.public_eligible_posts eligible join private.posts p on p.id=eligible.id
    join private.post_contacts c on c.post_id=p.id and p_channel=any(c.channels)
    join private.verification_phone_proofs f on f.owner_id=p.owner_id and f.revoked_at is null
    where p.id=p_post_id;
  return number;
end;
$function$;
alter function internal.reveal_post_phone(uuid,text) owner to postgres;
revoke all on function internal.reveal_post_phone(uuid,text) from public;
grant execute on function internal.reveal_post_phone(uuid,text) to service_role;

CREATE OR REPLACE FUNCTION internal.frontend_post_presentation(p_post uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select jsonb_build_object('data',coalesce((select internal.public_post_presentation_data(p.kind::text,d.data)
      from private.post_presentations d join private.posts p on p.id=d.post_id where d.post_id=p_post),'{}'::jsonb),
   'media',coalesce((select jsonb_agg(jsonb_build_object('purpose',r.purpose,'position',r.position,'object_key',m.object_key,
     'width',m.width,'height',m.height) order by r.purpose,r.position)
     from private.post_presentation_media r join private.media_objects m on m.id=r.object_id
     join private.posts p on p.id=r.post_id and p.owner_id=m.owner_id
     where r.post_id=p_post and m.state='ready' and m.kind='image'),'[]'::jsonb)) || coalesce((select jsonb_build_object('business_contacts',d.contacts)
      from private.post_presentations d join private.posts p on p.id=d.post_id
      where d.post_id=p_post and p.kind='business'),'{}'::jsonb);
$function$;
alter function internal.frontend_post_presentation(uuid) owner to postgres;
revoke all on function internal.frontend_post_presentation(uuid) from public;

drop function internal.business_contact_number(jsonb,jsonb,text);

commit;
