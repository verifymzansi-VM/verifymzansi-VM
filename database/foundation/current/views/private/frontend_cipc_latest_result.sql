-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create view private.frontend_cipc_latest_result with (security_invoker=true) as
 SELECT DISTINCT ON (x.business_id) x.id,
    x.business_id,
    x.owner_id,
    x.kind,
    x.status,
    x.decided_at,
    x.expires_at,
    x.revoked_at,
    d.registration_number,
    d.registered_name,
    d.route,
    d.accepted_role,
    d.position_title,
    d.registered_office,
    d.display_full_office,
    d.linked_business_id
   FROM private.frontend_business_checks x
     JOIN private.frontend_cipc_reviews d ON d.check_id = x.id
     JOIN private.posts p ON p.id = x.business_id AND p.owner_id = x.owner_id AND p.kind = 'business'::text
  WHERE (x.kind = ANY (ARRAY['cipc'::text, 'cipc_link'::text])) AND (x.status = 'approved'::text OR x.revoked_at IS NOT NULL)
  ORDER BY x.business_id, x.decided_at DESC, x.id DESC;
alter view private.frontend_cipc_latest_result owner to postgres;
revoke all on private.frontend_cipc_latest_result from public;
