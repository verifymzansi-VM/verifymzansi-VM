-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create view private.public_eligible_posts with (security_invoker=true) as
 SELECT id
   FROM ( SELECT p.id
           FROM private.posts p
             JOIN private.current_account_access u ON u.id = p.owner_id
          WHERE p.status = 'live'::text AND p.published_at <= statement_timestamp() AND (p.kind = 'event'::text AND p.visible_until > statement_timestamp() AND (EXISTS ( SELECT 1
                   FROM private.event_details e_1
                  WHERE e_1.post_id = p.id AND e_1.ends_at > statement_timestamp())) OR p.kind <> 'event'::text AND (EXISTS ( SELECT 1
                   FROM private.post_activations a
                     JOIN private.entitlements e_1 ON e_1.id = a.entitlement_id
                     JOIN private.current_account_access funding_owner ON funding_owner.id = e_1.owner_id
                  WHERE a.post_id = p.id AND a.owner_id = p.owner_id AND a.released_at IS NULL AND internal.slot_grant_usable(e_1.id, e_1.status, e_1.starts_at, e_1.ends_at) AND (e_1.area IS NULL OR e_1.area = p.area) AND (e_1.owner_id = p.owner_id OR (EXISTS ( SELECT 1
                           FROM private.entitlement_members m
                          WHERE m.entitlement_id = e_1.id AND m.member_id = p.owner_id))) AND (( SELECT count(DISTINCT pm.object_id) AS count
                           FROM private.post_media pm
                          WHERE pm.post_id = p.id AND pm.purpose <> 'video'::text)) <= e_1.max_photos AND (( SELECT count(DISTINCT pm.object_id) AS count
                           FROM private.post_media pm
                          WHERE pm.post_id = p.id AND pm.purpose = 'video'::text)) <= e_1.max_videos AND (e_1.source <> 'retail_paid'::text OR (EXISTS ( SELECT 1
                           FROM private.payments pay
                          WHERE pay.id = e_1.payment_id AND pay.owner_id = e_1.owner_id AND pay.status = 'complete'::text))))))) e
  WHERE NOT (EXISTS ( SELECT 1
           FROM private.frontend_content_holds h
          WHERE h.post_id = e.id AND h.released_at IS NULL));
alter view private.public_eligible_posts owner to postgres;
revoke all on private.public_eligible_posts from public;
