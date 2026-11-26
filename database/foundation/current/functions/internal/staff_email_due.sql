-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_email_due(p_kind text, p_item uuid, p_staff uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.staff_roles r join private.staff_capabilities c on c.role=r.role
      where r.user_id=p_staff and r.revoked_at is null and c.capability=internal.staff_email_capability(p_kind))
    and exists(select 1 from private.current_account_access a where a.id=p_staff)
    -- Every staff page needs one (internal.staff_actor).
    and exists(select 1 from auth.mfa_factors f where f.user_id=p_staff and f.factor_type='totp' and f.status='verified')
    and case p_kind
      when 'staff_privacy_request' then exists(select 1 from private.privacy_requests x where x.id=p_item
        and x.status in('submitted','identity_pending','in_progress') and x.minimised_at is null)
      -- Never to whoever took, approved or reported the decision appealed
      -- against: they may not decide the appeal.
      when 'staff_appeal' then exists(select 1 from private.frontend_appeals x where x.id=p_item and x.status='submitted'
        and not exists(select 1 from private.frontend_appealable_actions d where d.id=x.action_id
          and d.account_id=x.appellant_id and p_staff in(d.actor_id,d.approver_id,d.reporter_id)))
      -- Never to the person the report is about or its reporter.
      when 'staff_report' then exists(select 1 from private.reports x where x.id=p_item and x.status='open'
        and x.subject_account_id<>p_staff and x.reporter_id is distinct from p_staff)
      else false end;
$function$;
alter function internal.staff_email_due(text,uuid,uuid) owner to postgres;
revoke all on function internal.staff_email_due(text,uuid,uuid) from public;
