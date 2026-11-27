-- Serve business phone numbers through the click-to-view route. The website's
-- "Show number" route (/api/contact/reveal, Turnstile and per-visitor limits)
-- asks api.reveal_post_phone (service only) for a post's number per channel.
-- Until now that returned the owner's verified account phone, and only for a
-- post whose contact choices (private.post_contacts) include the channel.
-- Businesses have no such row (their form never sends one), so the route had
-- nothing to answer for a business and the pages showed the business's own
-- numbers from the public card read instead.
--
-- internal.reveal_post_phone, full body: for a publicly live Business or
-- Tourism business it returns the number the business chose on its form
-- (private.post_presentations.contacts: 'phone' for call, 'whatsapp' for
-- whatsapp), normalised to +27 followed by nine digits:
-- - call: any South African number, landline or mobile (0 then 1-8, then 8
--   digits; also given as 27... or +27...); spaces, brackets and dashes are
--   ignored;
-- - whatsapp: a mobile number only (0 then 6, 7 or 8);
-- - anything else, or no number, gives null.
-- Listings and events are unchanged: the owner's verified number, only for a
-- channel the owner chose.
--
-- Expand only: one replaced body; no command, argument, grant or table
-- changes.
-- ORDER: apply first (apply, then merge). The current website never asks for
-- a business number (it finds no contact choices for a business), so nothing
-- changes until the website that uses it is deployed.
-- It refuses with 55000 unless internal.reveal_post_phone has its reviewed
-- body (or this update's).
-- Read-only preflight: ../preflight/20261127055550_reveal_business_contacts.check.sql.
-- Rollback: ../rollback/20261127055550_reveal_business_contacts.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.reveal_post_phone(uuid,text)');
  if body is null or body not in('98baceb9be415a5ba2150793263e58e1','3c71cc40436dfcc792ecea4ed0d0db3f') then
    raise exception 'business contacts reveal precondition: internal.reveal_post_phone(uuid,text) is not the reviewed body (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

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
    -- The business's own number, as chosen on its form, in +27 form.
    select regexp_replace(d.contacts->>(case p_channel when 'call' then 'phone' else 'whatsapp' end),'[ ()-]','','g')
      into number from private.post_presentations d where d.post_id=p_post_id;
    number:=case
      when number ~ '^0[1-8][0-9]{8}$' then '+27'||substr(number,2)
      when number ~ '^27[1-8][0-9]{8}$' then '+'||number
      when number ~ '^[+]27[1-8][0-9]{8}$' then number end;
    if p_channel='whatsapp' and number !~ '^[+]27[6-8]' then return null; end if;
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

commit;
