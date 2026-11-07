-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.withdraw_frontend_business_check(p_business uuid, p_case uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();now_at timestamptz;current_case private.frontend_business_checks;
begin
  perform internal.lock_verification_subject(actor);
  perform 1 from private.posts p where p.id=p_business and p.owner_id=actor and p.kind='business' for update;
  if not found then raise exception 'business unavailable for this member' using errcode='PT404';end if;
  perform 1 from private.evidence_cases e where e.id=p_case and e.subject_id=actor and e.status='open' for update;
  if not found then raise exception 'no open check' using errcode='PT409';end if;
  select * into current_case from private.frontend_business_checks c
    where c.id=p_case and c.business_id=p_business and c.owner_id=actor and c.status in('pending','info_requested') for update;
  if not found then raise exception 'no open check' using errcode='PT409';end if;
  now_at:=clock_timestamp();
  update private.evidence_cases set status='closed',claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=p_case;
  update private.frontend_business_checks set status='withdrawn',decided_at=now_at,updated_at=now_at where id=p_case;
  update private.evidence_artifacts set retain_until=least(coalesce(retain_until,'infinity'::timestamptz),now_at+interval '30 days')
    where case_id=p_case and state='clean';
  perform internal.price_draft_actor();return jsonb_build_object('ok',true);
end$function$;
alter function internal.withdraw_frontend_business_check(uuid,uuid) owner to postgres;
revoke all on function internal.withdraw_frontend_business_check(uuid,uuid) from public;
grant execute on function internal.withdraw_frontend_business_check(uuid,uuid) to authenticated;
