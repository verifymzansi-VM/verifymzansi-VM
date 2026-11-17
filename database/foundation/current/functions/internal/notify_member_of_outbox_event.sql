-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.notify_member_of_outbox_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare post private.posts;
begin
  -- Only the email kinds that add no notice of their own; enquiries, account
  -- notices, business checks and returned ID checks already do.
  if new.kind not in('identity_accepted','verification_phone_confirmed','payment_completed','payment_reversed',
      'payment_reconciliation_required','trial_started','post_expired','draft_deletion_warning','post_deleted',
      'post_sold','post_kept','slot_renewal_reminder') then
    return null;
  end if;
  -- A notice never fails the event that caused it.
  if not exists(select 1 from auth.users u where u.id=new.owner_id) then return null; end if;
  if new.kind in('post_expired','draft_deletion_warning','post_deleted','post_sold','post_kept') then
    select p.* into post from private.posts p where p.id=new.subject_id;
    -- A rejected edit's copy is warned about and deleted like a post, but the
    -- live post stays; its owner was already told the changes were rejected.
    if post.edit_of is not null then return null; end if;
  end if;
  -- Reversing several lines of one payment queues one email per line: one
  -- notice is enough.
  if new.kind='payment_reversed' and exists(select 1 from private.notifications n where n.account_id=new.owner_id
      and n.kind='payment_reversed' and n.subject_id=new.subject_id and n.created_at>=transaction_timestamp()) then
    return null;
  end if;
  -- A payment that could not be applied also queues payment_reconciliation_required:
  -- "payment received" would contradict it.
  if new.kind='payment_completed' and exists(select 1 from private.payments y where y.id=new.subject_id
      and y.fulfillment_status='needs_reconciliation') then
    return null;
  end if;
  -- A post notice links its post, so it goes with the post. post_deleted is
  -- written just before its post is removed: it keeps the id as subject only.
  perform internal.notify_account(new.owner_id,new.kind,new.subject_id,
    case when new.kind<>'post_deleted' then post.id end,null);
  return null;
end;
$function$;
alter function internal.notify_member_of_outbox_event() owner to postgres;
revoke all on function internal.notify_member_of_outbox_event() from public;
