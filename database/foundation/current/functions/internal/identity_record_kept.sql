-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_record_kept(p_submission uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.accepted_identity_facts f
    where f.submission_id=p_submission and (f.revoked_at is null
      or exists(select 1 from private.account_closures x where x.user_id=f.owner_id
        and x.evidence_delete_after>statement_timestamp())
      or exists(select 1 from private.reports r where r.status='open'
        and (r.subject_account_id=f.owner_id or r.post_id in(select p.id from private.posts p where p.owner_id=f.owner_id)))
      or exists(select 1 from private.banned_identities b where b.identity_hmac=f.identity_hmac
        and b.retain_until>statement_timestamp())));
$function$;
alter function internal.identity_record_kept(uuid) owner to postgres;
revoke all on function internal.identity_record_kept(uuid) from public;
