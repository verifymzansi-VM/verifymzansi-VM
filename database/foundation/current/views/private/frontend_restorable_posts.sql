-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create view private.frontend_restorable_posts with (security_invoker=true) as
 SELECT p.id
   FROM private.posts p
     JOIN private.current_account_access u ON u.id = p.owner_id
  WHERE (p.status = ANY (ARRAY['live'::text, 'paused'::text])) AND p.published_at <= statement_timestamp() AND p.visible_until > statement_timestamp() AND (p.kind = 'event'::text AND (EXISTS ( SELECT 1
           FROM private.event_details e
          WHERE e.post_id = p.id AND e.ends_at > statement_timestamp())) OR p.kind <> 'event'::text AND (EXISTS ( SELECT 1
           FROM private.post_activations a
             JOIN private.entitlements e ON e.id = a.entitlement_id
             JOIN private.current_account_access funding_owner ON funding_owner.id = e.owner_id
          WHERE a.post_id = p.id AND a.owner_id = p.owner_id AND a.released_at IS NULL AND internal.entitlement_usable(e.status, e.starts_at, e.ends_at) AND (e.area IS NULL OR e.area = p.area) AND (e.owner_id = p.owner_id OR (EXISTS ( SELECT 1
                   FROM private.entitlement_members m
                  WHERE m.entitlement_id = e.id AND m.member_id = p.owner_id))) AND (( SELECT count(DISTINCT pm.object_id) AS count
                   FROM private.post_media pm
                  WHERE pm.post_id = p.id AND pm.purpose <> 'video'::text)) <= e.max_photos AND (( SELECT count(DISTINCT pm.object_id) AS count
                   FROM private.post_media pm
                  WHERE pm.post_id = p.id AND pm.purpose = 'video'::text)) <= e.max_videos AND (e.source <> 'retail_paid'::text OR (EXISTS ( SELECT 1
                   FROM private.payments pay
                  WHERE pay.id = e.payment_id AND pay.owner_id = e.owner_id AND pay.status = 'complete'::text))))));
alter view private.frontend_restorable_posts owner to postgres;
revoke all on private.frontend_restorable_posts from public;
