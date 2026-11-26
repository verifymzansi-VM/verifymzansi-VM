-- Follow-ups to the small lifecycle rules (launch checklist item 56, batch D;
-- 20261125150215_small_lifecycle_rules.sql, item 40).
--
-- 1. A visitor's report holds an owner's deletion for a limited time.
--    internal.delete_post (full body) refused while any report on the post was
--    open, with no end, so a report nobody looked at could keep a paid slot or
--    a free event place taken until staff acted. It
--    now refuses (same PT409, detail post_report_open) only while an open
--    report from the public exists and either that report is less than 7 days
--    old or internal.post_report_deferred(post) holds: the clean-up's own
--    rule, which stops waiting 7 days after the post would otherwise be deleted
--    (67 days after its last change when it has no deletion date). The 7 days
--    from the report give staff time to look even when the post itself has
--    not changed for months. A staff duplicate-event flag (report_origin 'staff')
--    never stops the deletion: it names a pair of posts, and the website's
--    message speaks of someone reporting the post. The scheduled clean-up is
--    unchanged.
-- 2. The sticker renewal reminder needs the owner's reviewed ID, which
--    renewing needs. internal.sticker_renewal_reminder_key (full body) also
--    requires internal.frontend_business_identity_reviewed(owner). The email
--    job compares the queued key with the current one, so a reminder queued
--    before the review lapsed is finished as skipped without a send, and is
--    not sent again for that sticker end (its key is used). Its
--    30-day period stays the one internal.queue_sticker_renewal_reminders
--    uses to pick candidates (both read "interval '30 days'"; the behaviour
--    test checks they agree).
--
-- No API command, argument, result or grant changes. ORDER: apply first, then
-- merge (either order is safe: the website from the same pull request only
-- adds wording, and the refusal and the claim keep their shapes).
-- It refuses with 55000 unless both functions have their reviewed bodies (or
-- this update's).
-- Read-only preflight: ../preflight/20261125225855_lifecycle_rule_follow_ups.check.sql.
-- Rollback: ../rollback/20261125225855_lifecycle_rule_follow_ups.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.delete_post(uuid,integer)'),('internal.sticker_renewal_reminder_key(uuid,uuid)')) v(sig)
  loop
    if shape not in (
        'internal.delete_post(uuid,integer) ba5e05f4803ab918135a4aa6dbf05ba1',
        'internal.delete_post(uuid,integer) 009322bbbd81a75ceaa3ec8fe3f4fef3',
        'internal.sticker_renewal_reminder_key(uuid,uuid) f0296fa207968b44d2249cbe31f02f1c',
        'internal.sticker_renewal_reminder_key(uuid,uuid) 122a9d4ca00a7b25bf47909b88d43901') then
      raise exception 'lifecycle rule follow-ups precondition: % is not a reviewed body', shape
        using errcode='55000';
    end if;
  end loop;
end$$;

-- 1. A visitor's report waits for staff as long as the clean-up does.
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
  -- A post with an open report from the public waits until staff have looked
  -- at it: for at least 7 days after the report, and for as long as the
  -- scheduled clean-up waits (internal.post_report_deferred). A staff duplicate
  -- flag does not stop it. The owner can still hide it.
  if exists (select 1 from private.reports r where r.post_id = post.id and r.status = 'open' and r.report_origin = 'public'
      and (internal.post_report_deferred(post) or r.created_at > clock_timestamp() - interval '7 days')) then
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

-- 2. The sticker renewal reminder only while the owner's ID is reviewed.
CREATE OR REPLACE FUNCTION internal.sticker_renewal_reminder_key(p_check uuid, p_owner uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- The 30 days match internal.queue_sticker_renewal_reminders, which picks
  -- the candidates; change both together.
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
    and exists(select 1 from private.current_account_access a where a.id=c.owner_id)
    -- Renewing needs the owner's reviewed ID.
    and internal.frontend_business_identity_reviewed(c.owner_id);
$function$;
alter function internal.sticker_renewal_reminder_key(uuid,uuid) owner to postgres;
revoke all on function internal.sticker_renewal_reminder_key(uuid,uuid) from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
