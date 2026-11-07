-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.owner_profile_dto(p private.profiles)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('display_name',p.display_name,
    'public_name',internal.profile_public_name(p.display_name),'bio',p.bio,
    'avatar_object_id',p.avatar_object_id,'legal_first_name',p.legal_first_name,
    'legal_last_name',p.legal_last_name,'legal_name_locked',p.legal_name_locked_at is not null,
    'identity_verified',exists(select 1 from private.accepted_identity_facts f
      where f.owner_id=p.account_id and f.revoked_at is null),
    'revision',p.revision,'updated_at',p.updated_at);
$function$;
alter function internal.owner_profile_dto(private.profiles) owner to postgres;
revoke all on function internal.owner_profile_dto(private.profiles) from public;
