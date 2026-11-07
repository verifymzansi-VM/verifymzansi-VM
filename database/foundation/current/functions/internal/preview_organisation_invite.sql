-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.preview_organisation_invite(p_token_hash text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('organisation_name',o.name,'email',internal.mask_email(i.email),'expires_at',i.expires_at,
    'status',case when i.accepted_at is not null then 'used' when i.revoked_at is not null then 'revoked'
      when i.expires_at<=statement_timestamp() then 'expired'
      when o.programme_status in('suspended','ended') then 'inactive' else 'open' end)
  from private.organisation_invites i join private.organisations o on o.id=i.organisation_id
  where p_token_hash ~ '^[a-f0-9]{64}$' and i.token_hash=p_token_hash;
$function$;
alter function internal.preview_organisation_invite(text) owner to postgres;
revoke all on function internal.preview_organisation_invite(text) from public;
grant execute on function internal.preview_organisation_invite(text) to anon;
grant execute on function internal.preview_organisation_invite(text) to authenticated;
