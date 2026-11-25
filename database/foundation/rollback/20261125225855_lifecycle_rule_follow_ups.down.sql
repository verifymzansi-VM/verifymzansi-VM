-- Reviewed rollback for updates/20261125225855_lifecycle_rule_follow_ups.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It puts back the bodies of internal.delete_post and
-- internal.sticker_renewal_reminder_key from
-- 20261125150215_small_lifecycle_rules.sql byte for byte (same signatures,
-- grants and owners): the owner's deletion again waits for every open report
-- with no end, and the reminder no longer asks for a reviewed ID. Nothing is
-- deleted. Reminders skipped meanwhile for a missing ID review are not sent
-- again for the same sticker end (the key is unchanged and already used). The
-- website from the update's pull request keeps working.
-- It refuses (55000) unless both functions have this update's bodies (a later
-- update changed one: undo that update first).
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.delete_post(uuid,integer)'),('internal.sticker_renewal_reminder_key(uuid,uuid)')) v(sig)
  loop
    if shape not in (
        'internal.delete_post(uuid,integer) eb15dab657d7512cc0f4d5f8036fa6db',
        'internal.sticker_renewal_reminder_key(uuid,uuid) 122a9d4ca00a7b25bf47909b88d43901') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
end$$;

-- 1. Owner deletion waits for every open report.
CREATE OR REPLACE FUNCTION internal.delete_post(p_post_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); post private.posts;
begin
  perform internal.assert_post_revision(p_expected_revision);
  -- Match hold placement/closure ordering: account subject before post rows.
  perform internal.lock_evidence_subject(actor);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found or post.edit_of is not null then raise exception 'post not found' using errcode = '22023'; end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if exists (select 1 from private.legal_holds h where h.subject_id = actor and h.released_at is null) then
    raise exception 'posts cannot be deleted during a legal hold' using errcode = 'PT409';
  end if;
  if exists (select 1 from private.frontend_content_holds h where h.post_id = post.id and h.released_at is null) then
    raise exception 'staff visibility hold requires independent release' using errcode = 'PT423', detail = 'staff_visibility_hold';
  end if;
  -- A post with an open report waits until staff have looked at it, the same
  -- rule the scheduled clean-up follows (internal.post_report_deferred). The
  -- owner can still hide it.
  if exists (select 1 from private.reports r where r.post_id = post.id and r.status = 'open') then
    raise exception 'a reported post cannot be deleted until staff have looked at the report'
      using errcode = 'PT409', detail = 'post_report_open';
  end if;
  -- Owner decision DEC-32 (an owner answer on keeping it is pending; removing
  -- this one statement stops owner deletions returning places): deleting
  -- one's own free event before it ends returns its place in the rolling
  -- submission limit. An event that has ended keeps its place.
  update private.event_submissions set released_at = statement_timestamp(), release_reason = 'owner_deleted'
    where post_id = post.id and owner_id = actor and released_at is null
      and exists (select 1 from private.event_details e where e.post_id = post.id and e.ends_at > statement_timestamp());
  delete from private.posts where id = post.id; -- with its edit copy, links and queue claim
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'deleted');
end;
$function$;
alter function internal.delete_post(uuid,integer) owner to postgres;
revoke all on function internal.delete_post(uuid,integer) from public,anon,service_role;
grant execute on function internal.delete_post(uuid,integer) to authenticated;

-- 2. The sticker renewal reminder without the ID review.
CREATE OR REPLACE FUNCTION internal.sticker_renewal_reminder_key(p_check uuid, p_owner uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select 'sticker_renewal_reminder:'||c.id||':'||floor(extract(epoch from c.expires_at))::bigint
  from private.frontend_business_checks c
  join private.posts b on b.id=c.business_id and b.owner_id=c.owner_id and b.kind='business'
    and b.edit_of is null and b.status not in('archived','sold')
  where c.id=p_check and c.owner_id=p_owner and c.kind in('cipc','seen') and c.status='approved'
    and c.expires_at>clock_timestamp() and c.expires_at<=clock_timestamp()+interval '30 days'
    and not exists(select 1 from private.frontend_business_checks x where x.business_id=c.business_id and x.id<>c.id
      and (x.kind=c.kind or (c.kind='cipc' and x.kind='cipc_link'))
      and (x.status in('pending','info_requested')
        or ((x.status='approved' or x.revoked_at is not null) and (x.decided_at,x.id)>(c.decided_at,c.id))))
    and exists(select 1 from private.current_account_access a where a.id=c.owner_id);
$function$;
alter function internal.sticker_renewal_reminder_key(uuid,uuid) owner to postgres;
revoke all on function internal.sticker_renewal_reminder_key(uuid,uuid) from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
