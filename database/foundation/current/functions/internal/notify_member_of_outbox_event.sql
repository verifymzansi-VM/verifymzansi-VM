-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.notify_member_of_outbox_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Only the email kinds that add no notice of their own; enquiries, account
  -- notices, business checks and returned ID checks already do.
  if new.kind not in('identity_accepted','verification_phone_confirmed','payment_completed','payment_reversed',
      'payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
      'draft_deletion_warning','post_deleted','post_sold','post_kept','slot_renewal_reminder') then
    return null;
  end if;
  -- A notice never fails the event that caused it.
  if not exists(select 1 from auth.users u where u.id=new.owner_id) then return null; end if;
  -- A post notice links its post, so it goes with the post. post_deleted is
  -- written just before its post is removed: it keeps the id as subject only.
  perform internal.notify_account(new.owner_id,new.kind,new.subject_id,
    case when new.kind in('post_expired','post_expiry_reminder','draft_deletion_warning','post_sold','post_kept')
      then (select p.id from private.posts p where p.id=new.subject_id) end,
    null);
  return null;
end;
$function$;
alter function internal.notify_member_of_outbox_event() owner to postgres;
revoke all on function internal.notify_member_of_outbox_event() from public;
