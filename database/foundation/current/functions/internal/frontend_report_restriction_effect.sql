-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_report_restriction_effect()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare proposal private.frontend_report_proposals;receipt private.frontend_report_action_receipts;r private.reports;subject uuid;actor uuid;finish timestamptz;
begin
  if new.scope_kind='native' or new.status not in('approved','withdrawn') then return new;end if;
  select * into proposal from private.frontend_report_proposals where decision_id=new.id;
  select * into receipt from private.frontend_report_action_receipts where id=proposal.receipt_id;
  select * into r from private.reports where id=receipt.report_id for update;
  select c.subject_id into subject from private.evidence_cases c where c.id=new.case_id;
  if proposal.decision_id is null or r.subject_account_id is distinct from subject or receipt.actor_id is distinct from new.proposed_by then raise exception 'bound report proposal required' using errcode='PT409';end if;
  if new.status='withdrawn' then
    actor:=auth.uid();
    if actor is distinct from new.withdrawn_by or actor=subject or actor=r.reporter_id then raise exception 'independent report refusal required' using errcode='42501';end if;
    update private.frontend_account_restrictions set lifted_at=clock_timestamp(),lifted_by=actor,lift_reason='Emergency review withdrawn or rejected',version=version+1
      where decision_id=new.id and emergency and lifted_at is null;
    update private.reports set active_proposal_id=null where id=r.id and active_proposal_id=new.id;
    return new;
  end if;
  actor:=internal.staff_actor('decision:approve');
  if actor is distinct from new.approved_by or actor in(subject,new.proposed_by) or actor=r.reporter_id then raise exception 'independent restriction approval required' using errcode='42501';end if;
  if proposal.expires_at<=clock_timestamp() or r.status<>'open' or r.revision<>proposal.report_revision or r.active_proposal_id is distinct from new.id
    or not exists(select 1 from private.staff_roles s join private.staff_capabilities c on c.role=s.role and c.capability='report:resolve' where s.user_id=new.proposed_by and s.revoked_at is null)
    or not exists(select 1 from private.current_account_access a where a.id=new.proposed_by)
    or exists(select 1 from private.account_closures c where c.user_id=subject) then raise exception 'report proposal expired or changed' using errcode='PT409';end if;
  if new.payload ? 'identity_fact_id' and not exists(select 1 from private.accepted_identity_facts f where f.id::text=new.payload->>'identity_fact_id' and f.owner_id=subject and f.revoked_at is null) then raise exception 'represented identity fact changed' using errcode='PT409';end if;
  finish:=case when new.scope_kind='report_suspension' then new.approved_at+make_interval(days=>new.suspension_days) end;
  insert into private.frontend_account_restrictions(decision_id,account_id,reporter_id,kind,reason,emergency,starts_at,ends_at)
    values(new.id,subject,r.reporter_id,case new.scope_kind when 'report_ban' then 'ban' else 'suspension' end,receipt.reason,false,new.approved_at,finish);
  update private.frontend_account_restrictions set lifted_at=clock_timestamp(),lifted_by=actor,lift_reason='Replaced by the independently approved decision',version=version+1
    where decision_id=new.id and emergency and lifted_at is null;
  update private.reports set status='resolved',resolution_note=receipt.reason,resolved_by=actor,resolved_at=clock_timestamp(),active_proposal_id=null where id=r.id;
  perform internal.staff_actor('decision:approve');return new;
end$function$;
alter function internal.frontend_report_restriction_effect() owner to postgres;
revoke all on function internal.frontend_report_restriction_effect() from public;
