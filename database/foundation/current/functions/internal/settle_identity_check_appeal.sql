-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.settle_identity_check_appeal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare subject uuid; reviewer uuid; outcome text;
begin
  if tg_table_name='accepted_identity_facts' then
    subject:=new.owner_id; reviewer:=new.reviewed_by; outcome:='overturned';
  elsif tg_table_name='verification_return_requests' then
    select c.subject_id into subject from private.evidence_cases c where c.id=new.case_id and c.kind='kyc';
    reviewer:=new.reviewer_id; outcome:='upheld';
  else raise exception 'unknown identity decision source';
  end if;
  if subject is not null then
    update private.frontend_appeals set status=outcome,reviewer_id=reviewer,
      reviewer_rationale='Decided in the identity review queue.',resolved_at=clock_timestamp()
      where appellant_id=subject and kind='identity_check' and status='submitted';
  end if;
  return new;
end$function$;
alter function internal.settle_identity_check_appeal() owner to postgres;
revoke all on function internal.settle_identity_check_appeal() from public;
