-- Reviewed rollback for updates/20261127055550_reveal_business_contacts.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. The click-to-view route then
-- answers nothing for a business again (a deployed website that relies on it
-- shows "This contact option is unavailable" for business numbers).
-- It refuses (55000) unless internal.reveal_post_phone has the update's body,
-- then puts back the earlier body byte for byte.
begin;
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.reveal_post_phone(uuid,text)');
  if body is distinct from '3c71cc40436dfcc792ecea4ed0d0db3f' then
    raise exception 'rollback precondition: the business contacts reveal update is not applied as reviewed (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
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

commit;
