-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_frontend_cipc_case(p_case uuid)
 RETURNS private.frontend_business_checks
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare subject uuid;x private.frontend_business_checks;
begin
  select owner_id into subject from private.frontend_business_checks where id=p_case and kind in('cipc','cipc_link');
  if subject is null then raise exception 'CIPC case unavailable' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);
  perform 1 from private.posts p join private.frontend_business_checks b on b.business_id=p.id and b.owner_id=p.owner_id
    where b.id=p_case and p.kind='business' for update of p;
  if not found then raise exception 'current business owner changed' using errcode='PT409';end if;
  perform 1 from private.evidence_cases c where c.id=p_case and c.subject_id=subject and c.status='open' for update;
  if not found then raise exception 'CIPC case is closed' using errcode='PT409';end if;
  select * into x from private.frontend_business_checks where id=p_case and status in('pending','info_requested') for update;
  if not found then raise exception 'CIPC case is closed' using errcode='PT409';end if;
  return x;
end$function$;
alter function internal.lock_frontend_cipc_case(uuid) owner to postgres;
revoke all on function internal.lock_frontend_cipc_case(uuid) from public;
