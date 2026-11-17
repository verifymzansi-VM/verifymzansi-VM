-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.account_erasure_hold(p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when exists (select 1 from private.legal_holds h where h.subject_id = p_user and h.released_at is null)
      then 'legal_hold'
    when exists (select 1 from private.evidence_cases c join private.evidence_fraud_holds f on f.case_id = c.id
        where c.subject_id = p_user and f.closed_at is null)
      then 'fraud_hold'
    when exists (select 1 from private.frontend_content_holds h where h.released_at is null
        and (h.account_id = p_user or h.post_id in (select p.id from private.posts p where p.owner_id = p_user)))
      then 'content_hold'
    when exists (select 1 from private.reports r where r.status = 'open'
        and (r.subject_account_id = p_user or r.post_id in (select p.id from private.posts p where p.owner_id = p_user)))
      then 'report_open'
    when exists (select 1 from private.staff_roles r where r.user_id = p_user and r.revoked_at is null)
      then 'staff_role'
    -- Staff rejected the deletion request (recorded on the erasure itself, so
    -- it outlives the request record) and no later request was ordered.
    when exists (select 1 from private.account_erasures e where e.user_id = p_user and e.rejected_at is not null)
      then 'request_rejected'
    when exists (select 1 from private.payments p where p.owner_id = p_user and p.status = 'pending')
      then 'payment_pending'
    when exists (select 1 from private.payments p where p.owner_id = p_user and p.status = 'complete'
        and p.fulfillment_status = 'needs_reconciliation')
      then 'payment_unresolved'
    when exists (select 1 from private.payment_refund_requests r where r.account_id = p_user
        and r.status in ('awaiting_approval', 'approved', 'sent'))
      then 'refund_open'
    when exists (select 1 from private.invoice_transfers t where t.account_id = p_user
        and internal.invoice_transfer_waiting(t))
      then 'transfer_waiting'
    when exists (select 1 from private.customer_invoices i where i.account_id = p_user and i.status = 'issued')
      then 'invoice_unpaid'
    when exists (select 1 from private.partner_commissions c join private.partners x on x.id = c.partner_id
        where x.account_id = p_user and c.status in ('pending', 'approved'))
      then 'commission_unpaid'
  end;
$function$;
alter function internal.account_erasure_hold(uuid) owner to postgres;
revoke all on function internal.account_erasure_hold(uuid) from public;
