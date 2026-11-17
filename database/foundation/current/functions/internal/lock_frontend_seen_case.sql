-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_frontend_seen_case(p_case uuid)
 RETURNS private.frontend_business_checks
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare subject uuid;x private.frontend_business_checks;
begin
  select owner_id into subject from private.frontend_business_checks where id=p_case;
  if subject is null then raise exception 'business check unavailable' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);
  perform p.id from private.posts p join private.frontend_business_checks b on b.business_id=p.id
    where b.id=p_case and p.owner_id=subject and p.kind='business' for update of p;
  if not found then raise exception 'business owner changed' using errcode='PT409';end if;
  perform 1 from private.evidence_cases e where e.id=p_case and e.subject_id=subject and e.status='open' for update;
  if not found then raise exception 'business check is no longer open' using errcode='PT409';end if;
  select * into x from private.frontend_business_checks c where c.id=p_case and c.kind='seen' and c.status='pending' for update;
  if not found then raise exception 'seen check is no longer pending' using errcode='PT409';end if;
  return x;
end$function$;
alter function internal.lock_frontend_seen_case(uuid) owner to postgres;
revoke all on function internal.lock_frontend_seen_case(uuid) from public;
