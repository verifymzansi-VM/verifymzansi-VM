-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reject_account_erasure(p_request uuid, p_staff uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare subject uuid;
begin
  select l.user_id into subject from private.account_erasure_requests l where l.request_id = p_request;
  if subject is null then return; end if;
  -- Under the account lock the erasure and hold writers take, then re-read.
  perform internal.lock_evidence_subject(subject);
  if exists (select 1 from private.account_erasures e where e.user_id = subject and e.erased_at is not null) then
    raise exception 'the account was already erased' using errcode = 'PT409', detail = 'account_erased';
  end if;
  update private.account_erasures set rejected_at = statement_timestamp() where user_id = subject;
  if not exists (select 1 from private.legal_holds h where h.subject_id = subject and h.released_at is null
      and h.reason like 'Deletion request rejected%') then
    insert into private.legal_holds (subject_id, reason, placed_by)
      values (subject, 'Deletion request rejected; review by '
        || to_char((statement_timestamp() at time zone 'Africa/Johannesburg') + interval '12 months', 'YYYY-MM-DD'),
        p_staff);
  end if;
end;
$function$;
alter function internal.reject_account_erasure(uuid,uuid) owner to postgres;
revoke all on function internal.reject_account_erasure(uuid,uuid) from public;
