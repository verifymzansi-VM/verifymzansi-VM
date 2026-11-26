-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.sticker_renewal_reminder_key(p_check uuid, p_owner uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- The 30 days match internal.queue_sticker_renewal_reminders, which picks
  -- the candidates; change both together.
  select 'sticker_renewal_reminder:'||c.id||':'||floor(extract(epoch from c.expires_at))::bigint
  from private.frontend_business_checks c
  join private.posts b on b.id=c.business_id and b.owner_id=c.owner_id and b.kind='business'
    and b.edit_of is null and b.status not in('archived','sold')
  where c.id=p_check and c.owner_id=p_owner and c.kind in('cipc','seen') and c.status='approved'
    and c.expires_at>clock_timestamp() and c.expires_at<=clock_timestamp()+interval '30 days'
    and not exists(select 1 from private.frontend_business_checks x where x.business_id=c.business_id and x.id<>c.id
      and (x.kind=c.kind or (c.kind='cipc' and x.kind='cipc_link'))
      and (x.status in('pending','info_requested')
        or ((x.status='approved' or x.revoked_at is not null) and (x.decided_at,x.id)>(c.decided_at,c.id))))
    and exists(select 1 from private.current_account_access a where a.id=c.owner_id)
    -- Renewing needs the owner's reviewed ID.
    and internal.frontend_business_identity_reviewed(c.owner_id);
$function$;
alter function internal.sticker_renewal_reminder_key(uuid,uuid) owner to postgres;
revoke all on function internal.sticker_renewal_reminder_key(uuid,uuid) from public;
