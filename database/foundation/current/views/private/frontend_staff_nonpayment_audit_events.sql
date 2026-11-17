-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create view private.frontend_staff_nonpayment_audit_events with (security_invoker=true) as
 SELECT 'moderation:'::text || m.id::text AS id,
    m.decided_at AS occurred_at,
    m.staff_id AS actor_id,
    m.post_id AS target_id,
    'post'::text AS target_type,
    'post:'::text || m.decision AS action,
    m.reason
   FROM private.moderation_log m
UNION ALL
 SELECT 'evidence_access:'::text || e.id::text AS id,
    e.accessed_at AS occurred_at,
    e.staff_id AS actor_id,
    e.case_id AS target_id,
    'case'::text AS target_type,
    'evidence:read'::text AS action,
    e.purpose AS reason
   FROM private.evidence_access_log e
UNION ALL
 SELECT 'decision_proposed:'::text || d.id::text AS id,
    d.proposed_at AS occurred_at,
    d.proposed_by AS actor_id,
    d.case_id AS target_id,
    'case'::text AS target_type,
    'decision:proposed'::text AS action,
    NULL::text AS reason
   FROM private.decisions d
UNION ALL
 SELECT 'decision_approved:'::text || d.id::text AS id,
    d.approved_at AS occurred_at,
    d.approved_by AS actor_id,
    d.case_id AS target_id,
    'case'::text AS target_type,
    'decision:approved'::text AS action,
    NULL::text AS reason
   FROM private.decisions d
  WHERE d.approved_at IS NOT NULL
UNION ALL
 SELECT 'decision_withdrawn:'::text || d.id::text AS id,
    d.withdrawn_at AS occurred_at,
    d.withdrawn_by AS actor_id,
    d.case_id AS target_id,
    'case'::text AS target_type,
    'decision:withdrawn'::text AS action,
    d.withdrawal_reason AS reason
   FROM private.decisions d
  WHERE d.withdrawn_at IS NOT NULL
UNION ALL
 SELECT 'organisation:'::text || o.id::text AS id,
    o.created_at AS occurred_at,
    o.actor_id,
    o.organisation_id AS target_id,
    'organisation'::text AS target_type,
    'organisation:'::text || o.action AS action,
    o.reason
   FROM private.organisation_events o
UNION ALL
 SELECT 'partner:'::text || p.id::text AS id,
    p.created_at AS occurred_at,
    p.actor_id,
    p.partner_id AS target_id,
    'partner'::text AS target_type,
    'partner:'::text || p.action AS action,
    p.reason
   FROM private.partner_events p
UNION ALL
 SELECT 'queue:'::text || q.id::text AS id,
    q.created_at AS occurred_at,
    q.actor_id,
    COALESCE(q.post_id, q.report_id) AS target_id,
        CASE
            WHEN q.post_id IS NULL THEN 'report'::text
            ELSE 'post'::text
        END AS target_type,
    'queue:'::text || q.event AS action,
    q.reason
   FROM private.queue_claim_events q
UNION ALL
 SELECT 'staff_granted:'::text || r.id::text AS id,
    r.granted_at AS occurred_at,
    r.granted_by AS actor_id,
    r.user_id AS target_id,
    'account'::text AS target_type,
    'staff:granted'::text AS action,
    NULL::text AS reason
   FROM private.staff_roles r
UNION ALL
 SELECT 'staff_revoked:'::text || r.id::text AS id,
    r.revoked_at AS occurred_at,
    r.revoked_by AS actor_id,
    r.user_id AS target_id,
    'account'::text AS target_type,
    'staff:revoked'::text AS action,
    NULL::text AS reason
   FROM private.staff_roles r
  WHERE r.revoked_at IS NOT NULL
UNION ALL
 SELECT 'governance_note:'::text || g.id::text AS id,
    g.created_at AS occurred_at,
    g.actor_id,
    d.case_id AS target_id,
    'case'::text AS target_type,
    'governance:'::text || g.action AS action,
    g.reason
   FROM private.frontend_governance_events g
     JOIN private.decisions d ON d.id = g.decision_id
UNION ALL
 SELECT 'feature_flag:'::text || f.id::text AS id,
    f.created_at AS occurred_at,
    f.actor_id,
    f.flag_id AS target_id,
    'feature_flag'::text AS target_type,
    'feature_flag:updated'::text AS action,
    f.reason
   FROM private.frontend_feature_flag_events f
UNION ALL
 SELECT 'evidence_claim:'::text || h.id::text AS id,
    h.created_at AS occurred_at,
    h.actor_id,
    h.case_id AS target_id,
    'case'::text AS target_type,
    'queue:'::text || h.event AS action,
    h.reason
   FROM private.frontend_evidence_claim_events h
UNION ALL
 SELECT 'report_action:'::text || r.id::text AS id,
    r.created_at AS occurred_at,
    r.actor_id,
    r.report_id AS target_id,
    'report'::text AS target_type,
    ('report:'::text || r.action) ||
        CASE r.status
            WHEN 'proposed'::text THEN '_proposed'::text
            WHEN 'emergency_applied'::text THEN '_emergency'::text
            ELSE ''::text
        END AS action,
    r.reason
   FROM private.frontend_report_action_receipts r
UNION ALL
 SELECT 'appeal_submit:'::text || a.id AS id,
    a.created_at AS occurred_at,
    a.appellant_id AS actor_id,
    a.appellant_id AS target_id,
    'account'::text AS target_type,
    'appeal:submitted'::text AS action,
    NULL::text AS reason
   FROM private.frontend_appeals a
UNION ALL
 SELECT 'appeal_review:'::text || a.id AS id,
    a.resolved_at AS occurred_at,
    a.reviewer_id AS actor_id,
    a.appellant_id AS target_id,
    'account'::text AS target_type,
    'appeal:'::text || a.status AS action,
    a.reviewer_rationale AS reason
   FROM private.frontend_appeals a
  WHERE a.resolved_at IS NOT NULL
UNION ALL
 SELECT 'restriction_lift:'::text || x.id AS id,
    x.lifted_at AS occurred_at,
    x.lifted_by AS actor_id,
    x.account_id AS target_id,
    'account'::text AS target_type,
    'restriction:lifted'::text AS action,
    x.lift_reason AS reason
   FROM private.frontend_account_restrictions x
  WHERE x.lifted_at IS NOT NULL
UNION ALL
 SELECT 'privacy_request:'::text || e.id AS id,
    e.occurred_at,
    e.actor_id,
    e.request_id AS target_id,
    'case'::text AS target_type,
    'privacy:'::text || e.action AS action,
    NULL::text AS reason
   FROM private.privacy_request_events e
UNION ALL
 SELECT 'staff_role_proposal:'::text || x.id AS id,
    x.created_at AS occurred_at,
    x.proposer_id AS actor_id,
    x.target_id,
    'account'::text AS target_type,
    'staff_role:proposed'::text AS action,
    x.reason
   FROM private.frontend_staff_role_changes x
  WHERE NOT x.direct_removal
UNION ALL
 SELECT 'staff_role_outcome:'::text || x.id AS id,
    x.decided_at AS occurred_at,
    x.reviewer_id AS actor_id,
    x.target_id,
    'account'::text AS target_type,
    'staff_role:'::text || x.status AS action,
    COALESCE(x.note, x.reason) AS reason
   FROM private.frontend_staff_role_changes x
  WHERE x.status <> 'proposed'::text;
alter view private.frontend_staff_nonpayment_audit_events owner to postgres;
revoke all on private.frontend_staff_nonpayment_audit_events from public;
