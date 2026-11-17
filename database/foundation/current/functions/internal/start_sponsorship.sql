-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.start_sponsorship(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare s private.organisation_sponsorships; o private.organisations; ends timestamptz; ent uuid; fingerprint text;
begin
  select * into s from private.organisation_sponsorships where id=p_id for update;
  if not found or s.status<>'waitlisted' then return false; end if;
  perform internal.lock_verification_subject(s.owner_id);
  select * into o from private.organisations where id=s.organisation_id;
  ends:=coalesce(o.programme_ends_at,statement_timestamp()+interval '180 days');
  if not exists(select 1 from private.organisation_affiliations f join private.posts p on p.id=f.post_id
      where f.id=s.affiliation_id and f.status='active' and p.owner_id=s.owner_id)
    or not exists(select 1 from private.current_account_access u where u.id=s.owner_id)
    or ends<=statement_timestamp() + interval '1 day' then
    update private.organisation_sponsorships set status='revoked',ended_at=statement_timestamp(),
      end_reason='Sponsorship basis no longer valid' where id=s.id;
    return false;
  end if;
  insert into private.entitlements(owner_id,source,area,sponsorship_id,slot_capacity,activations_per_period,
      activation_period_days,max_photos,max_videos,starts_at,ends_at)
    values(s.owner_id,'sponsorship','business',s.id,1,10,30,10,1,statement_timestamp(),ends)
    returning id into ent;
  update private.organisation_sponsorships set status='active',starts_at=statement_timestamp(),ends_at=ends,
    entitlement_id=ent where id=s.id;
  fingerprint:=internal.current_verified_identity(s.owner_id);
  if fingerprint is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint,2701));
    insert into private.trial_identities(identity_hmac,owner_id,entitlement_id) values(fingerprint,s.owner_id,ent)
      on conflict(identity_hmac) do nothing;
  end if;
  perform internal.notify_account(s.owner_id,'organisation_sponsorship_activated',s.id,s.post_id,s.organisation_id);
  return true;
end;
$function$;
alter function internal.start_sponsorship(uuid) owner to postgres;
revoke all on function internal.start_sponsorship(uuid) from public;
