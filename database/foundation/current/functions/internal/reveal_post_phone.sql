-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
    -- A channel the business switched on shows the owner's current verified
    -- number (the same phone proof as listings and events), so a changed
    -- verified number reaches every business post at once.
    select f.phone into number from private.post_presentations d
      join private.posts p on p.id=d.post_id
      join private.verification_phone_proofs f on f.owner_id=p.owner_id and f.revoked_at is null
      where d.post_id=p_post_id and internal.business_contact_number(d.data,d.contacts,p_channel) is not null;
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
