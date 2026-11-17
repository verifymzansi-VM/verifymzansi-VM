-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create view private.frontend_appealable_actions with (security_invoker=true) as
 SELECT x.decision_id AS id,
    x.account_id,
    x.kind,
    x.reason,
    x.starts_at,
    x.ends_at,
    x.lifted_at IS NULL AND (x.ends_at IS NULL OR x.ends_at > statement_timestamp()) AS active,
    NOT x.emergency AS appealable,
    d.proposed_by AS actor_id,
    d.approved_by AS approver_id,
    x.reporter_id,
    x.id AS effect_id,
    x.version AS effect_version
   FROM private.frontend_account_restrictions x
     JOIN private.decisions d ON d.id = x.decision_id
  WHERE NOT x.emergency OR NOT (EXISTS ( SELECT 1
           FROM private.frontend_account_restrictions y
          WHERE y.decision_id = x.decision_id AND NOT y.emergency))
UNION ALL
 SELECT h.id,
    h.account_id,
    'content_hidden'::text AS kind,
    h.reason,
    h.applied_at AS starts_at,
    NULL::timestamp with time zone AS ends_at,
    h.released_at IS NULL AND h.post_id IS NOT NULL AS active,
    true AS appealable,
    h.actor_id,
    NULL::uuid AS approver_id,
    h.reporter_id,
    h.id AS effect_id,
    h.version AS effect_version
   FROM private.frontend_content_holds h
UNION ALL
 SELECT w.receipt_id AS id,
    w.account_id,
    'warning'::text AS kind,
    a.reason,
    a.created_at AS starts_at,
    NULL::timestamp with time zone AS ends_at,
    false AS active,
    true AS appealable,
    a.actor_id,
    NULL::uuid AS approver_id,
    r.reporter_id,
    NULL::uuid AS effect_id,
    NULL::integer AS effect_version
   FROM private.frontend_account_warnings w
     JOIN private.frontend_report_action_receipts a ON a.id = w.receipt_id
     JOIN private.reports r ON r.id = a.report_id;
alter view private.frontend_appealable_actions owner to postgres;
revoke all on private.frontend_appealable_actions from public;
