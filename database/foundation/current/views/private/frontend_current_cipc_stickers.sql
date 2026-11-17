-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create view private.frontend_current_cipc_stickers with (security_invoker=true) as
 SELECT x.id,
    x.business_id,
    x.owner_id,
    x.kind,
    x.registration_number,
    COALESCE(root.registered_name, x.registered_name) AS registered_name,
    COALESCE(root.accepted_role, x.accepted_role) AS accepted_role,
    COALESCE(root.position_title, x.position_title) AS position_title,
    COALESCE(root.registered_office, x.registered_office) AS registered_office,
    x.display_full_office,
    x.decided_at,
    COALESCE(root.expires_at, x.expires_at) AS expires_at,
    x.linked_business_id
   FROM private.frontend_cipc_latest_result x
     LEFT JOIN private.frontend_cipc_latest_result root ON root.business_id = x.linked_business_id AND root.owner_id = x.owner_id AND root.kind = 'cipc'::text AND root.status = 'approved'::text AND root.registration_number = x.registration_number AND root.expires_at > statement_timestamp()
  WHERE x.status = 'approved'::text AND internal.frontend_business_identity_reviewed(x.owner_id) AND (EXISTS ( SELECT 1
           FROM private.current_account_access a
          WHERE a.id = x.owner_id)) AND (x.kind = 'cipc'::text AND x.expires_at > statement_timestamp() OR x.kind = 'cipc_link'::text AND root.id IS NOT NULL);
alter view private.frontend_current_cipc_stickers owner to postgres;
revoke all on private.frontend_current_cipc_stickers from public;
