-- Serve business phone numbers only through the click-to-view route. The
-- website's "Show number" route (/api/contact/reveal, Turnstile and
-- per-visitor limits) asks api.reveal_post_phone (service only) for a post's
-- number per channel. Until now that returned the owner's verified account
-- phone, and only for a post whose contact choices (private.post_contacts)
-- include the channel. Businesses have no such row (their form never sends
-- one), so the route had nothing to answer for a business, and the public card
-- read (api.search_post_cards with frontend_presentation, open to anon and
-- authenticated) returned the business's stored numbers as business_contacts.
--
-- internal.business_contact_number(data, contacts, channel), new: the number
-- a business serves for a channel, from its stored presentation data and
-- contacts (private.post_presentations): 'phone' for call, 'whatsapp' for
-- whatsapp, normalised to +27 followed by nine digits, or null:
-- - the channel must be ticked in data.category_details.contact_methods when
--   the business has that list (a business saved before the list existed
--   offers each number it has, as its form shows it);
-- - the number is 0 then nine digits (also given as 27... or +27...);
--   spaces, brackets and dashes are ignored;
-- - call: a landline (01x-05x area codes) or a mobile (06x, 071-074, 076-079
--   or 081-084), the business form's rule (businessNumber in
--   src/lib/utils/phone.ts);
-- - whatsapp: a mobile only (not a landline, 080 toll-free, 086 share-call
--   or 087);
-- - anything else, or no number, gives null.
--
-- internal.reveal_post_phone, full body: for a publicly live Business or
-- Tourism business it returns internal.business_contact_number. Listings and
-- events are unchanged: the owner's verified number, only for a channel the
-- owner chose.
--
-- internal.frontend_post_presentation, full body: it no longer returns
-- business_contacts. For a business, 'data' carries
-- business_contact_options {call, whatsapp}: booleans, true when
-- internal.business_contact_number has a number for that channel. No public
-- read returns a business number. The key sits inside 'data' because the
-- current website's parser accepts any key there and rejects unknown keys
-- beside it, so it keeps working between the apply and the deploy (without
-- business_contacts it shows no business number buttons until then). The
-- owner's read (internal.frontend_owner_post) keeps its own 'contacts' and
-- replaces 'data' with the full stored presentation, so owners and staff
-- review still see the numbers; that function is unchanged.
--
-- Expand only: one new internal function and two replaced bodies; no command,
-- argument, grant or table changes.
-- ORDER: apply first (apply, then merge). The current website never asks for a
-- business number through the reveal and ignores the new data key; it shows no
-- business number buttons until the website that uses "Show number" for
-- businesses is deployed. A website deployed before this update would get no
-- business number from the reveal (404 for every business "Show number").
-- It refuses with 55000 unless internal.reveal_post_phone and
-- internal.frontend_post_presentation have their reviewed bodies (or this
-- update's) and internal.business_contact_number is absent (or this
-- update's).
-- Read-only preflight: ../preflight/20261127055550_reveal_business_contacts.check.sql.
-- Rollback: ../rollback/20261127055550_reveal_business_contacts.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare r record;
begin
  for r in select v.sig,v.allowed,
      (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) as body
    from (values
      ('internal.reveal_post_phone(uuid,text)',array['98baceb9be415a5ba2150793263e58e1','a30f22dd9c40c95cdc35abb9dcf5e204']),
      ('internal.frontend_post_presentation(uuid)',array['9f279565fc4eca46f6b355313a2271a3','c679983dbb6c63714de6be71c459ee85']),
      ('internal.business_contact_number(jsonb,jsonb,text)',array['absent','a8c5205effcf3619be14645e2ce26cf7'])
    ) v(sig,allowed) loop
    if not coalesce(r.body,'absent')=any(r.allowed) then
      raise exception 'business contacts reveal precondition: % is not the reviewed body (%)',r.sig,coalesce(r.body,'absent')
        using errcode='55000';
    end if;
  end loop;
end$$;

CREATE OR REPLACE FUNCTION internal.business_contact_number(p_data jsonb, p_contacts jsonb, p_channel text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select case
   when p_channel is null or p_channel not in('call','whatsapp') then null
   when jsonb_typeof(p_data#>'{category_details,contact_methods}')='array'
     and not (p_data#>'{category_details,contact_methods}') ? p_channel then null
   when n ~ '^[+]27(6[0-9]|7[1-46-9]|8[1-4])' then n
   when p_channel='call' and n ~ '^[+]27[1-5]' then n end
 from (select case when v ~ '^(0|27|[+]27)[1-9][0-9]{8}$' then '+27'||right(v,9) end as n
   from (select regexp_replace(case when jsonb_typeof(p_contacts)='object'
       then p_contacts->>(case p_channel when 'call' then 'phone' else 'whatsapp' end) end,'[ ()-]','','g') as v) s) t;
$function$;
alter function internal.business_contact_number(jsonb,jsonb,text) owner to postgres;
revoke all on function internal.business_contact_number(jsonb,jsonb,text) from public;

CREATE OR REPLACE FUNCTION internal.reveal_post_phone(p_post_id uuid, p_channel text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare number text; post_kind text;
begin
  if p_channel is null or p_channel not in('call','whatsapp') then raise exception 'invalid channel' using errcode='22023'; end if;
  select p.kind::text into post_kind from private.public_eligible_posts eligible join private.posts p on p.id=eligible.id
    where p.id=p_post_id;
  if post_kind is null then return null; end if;
  if post_kind='business' then
    -- The business's own number for a ticked channel, in +27 form.
    select internal.business_contact_number(d.data,d.contacts,p_channel)
      into number from private.post_presentations d where d.post_id=p_post_id;
    return number;
  end if;
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
        || case when p.kind='business' then jsonb_build_object('business_contact_options',jsonb_build_object(
          'call',internal.business_contact_number(d.data,d.contacts,'call') is not null,
          'whatsapp',internal.business_contact_number(d.data,d.contacts,'whatsapp') is not null)) else '{}'::jsonb end
      from private.post_presentations d join private.posts p on p.id=d.post_id where d.post_id=p_post),'{}'::jsonb),
   'media',coalesce((select jsonb_agg(jsonb_build_object('purpose',r.purpose,'position',r.position,'object_key',m.object_key,
     'width',m.width,'height',m.height) order by r.purpose,r.position)
     from private.post_presentation_media r join private.media_objects m on m.id=r.object_id
     join private.posts p on p.id=r.post_id and p.owner_id=m.owner_id
     where r.post_id=p_post and m.state='ready' and m.kind='image'),'[]'::jsonb));
$function$;
alter function internal.frontend_post_presentation(uuid) owner to postgres;
revoke all on function internal.frontend_post_presentation(uuid) from public;

commit;
