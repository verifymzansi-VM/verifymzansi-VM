-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create view private.current_account_access with (security_invoker=true) as
 SELECT id
   FROM auth.users u
  WHERE is_anonymous IS FALSE AND deleted_at IS NULL AND email_confirmed_at IS NOT NULL AND (banned_until IS NULL OR banned_until <= statement_timestamp()) AND NOT (EXISTS ( SELECT 1
           FROM private.account_closures c
          WHERE c.user_id = u.id)) AND NOT (EXISTS ( SELECT 1
           FROM private.decisions d
             JOIN private.evidence_cases c ON c.id = d.case_id
             LEFT JOIN private.frontend_account_restrictions x ON x.decision_id = d.id AND NOT x.emergency
          WHERE c.subject_id = u.id AND d.status = 'approved'::text AND d.action = 'restrict_account'::text AND x.lifted_at IS NULL AND ((d.scope_kind = ANY (ARRAY['native'::text, 'report_ban'::text])) OR LEAST(d.approved_at + make_interval(days => d.suspension_days), x.ends_at) > statement_timestamp()))) AND NOT (EXISTS ( SELECT 1
           FROM private.frontend_account_restrictions x
          WHERE x.account_id = u.id AND x.emergency AND x.lifted_at IS NULL AND x.ends_at > statement_timestamp()));
alter view private.current_account_access owner to postgres;
revoke all on private.current_account_access from public;
