-- Reviewed rollback for updates/20261119172135_post_views_and_likes.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix; to stop showing the counters,
-- switch SHOW_ENGAGEMENT_TOTALS off instead.
--
-- It drops the three commands, their internal functions, the purge and
-- trigger functions, the six tables and the two safety-valve cost allowances
-- (with any alarm they raised), and puts back the earlier bodies of
-- the privacy export, the retention job and account erasure byte for byte.
-- Revert and deploy the website release first: the rollback removes commands
-- that release calls. It refuses (55000) unless every part of the update is
-- present with this update's bodies, and once any like or counted view is
-- recorded, since those cannot be restored.
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  if to_regclass('private.engagement_keys') is null
    or to_regclass('private.post_view_salts') is null
    or to_regclass('private.post_view_marks') is null
    or to_regclass('private.post_view_days') is null
    or to_regclass('private.post_engagement_totals') is null
    or to_regclass('private.post_likes') is null
    or to_regprocedure('internal.record_post_views(uuid[],uuid,uuid)') is null
    or to_regprocedure('api.record_post_views(uuid[],uuid,uuid)') is null
    or to_regprocedure('internal.set_post_like(uuid,uuid,uuid,boolean,timestamptz)') is null
    or to_regprocedure('api.set_post_like(uuid,uuid,uuid,boolean,timestamptz)') is null
    or to_regprocedure('internal.get_post_engagement(uuid[])') is null
    or to_regprocedure('api.get_post_engagement(uuid[])') is null
    or to_regprocedure('internal.purge_post_engagement()') is null
    or to_regprocedure('internal.post_likes_count()') is null then
    raise exception 'rollback precondition: post views and likes are not fully present'
      using errcode='55000';
  end if;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p
        where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.frontend_privacy_export_data(uuid)'), ('internal.run_retention(integer)'),
      ('internal.erase_closed_account(uuid,text)')) v(sig)
  loop
    if shape not in (
        'internal.frontend_privacy_export_data(uuid) 3dfe35ae5e93f0661ecd7dbf710cf45d',
        'internal.run_retention(integer) 06a3fbfcb5b2d53e2487719174a62cc5',
        'internal.erase_closed_account(uuid,text) c1352cec14d02d401b58e466c387d747') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from private.post_likes) or exists(select 1 from private.post_view_days) then
    raise exception 'rollback precondition: likes or views are recorded and would be lost'
      using errcode='55000';
  end if;
end$$;

CREATE OR REPLACE FUNCTION internal.frontend_privacy_export_data(p_subject uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare entry record;items jsonb;row_count integer;result jsonb:='{}';size_so_far bigint:=0;
begin
  for entry in select * from (values
    ('profile',$q$select account_id,display_name,bio,legal_first_name,legal_last_name,legal_name_locked_at,created_at,updated_at from private.profiles where account_id=$1$q$),
    ('account',$q$select id,email,email_confirmed_at,phone,phone_confirmed_at,created_at,last_sign_in_at from auth.users where id=$1 and deleted_at is null$q$),
    ('listing_drafts',$q$select category_key,price_mode,price_cents,price_negotiable,revision,expires_at from private.listing_price_drafts where owner_id=$1$q$),
    ('posts',$q$select p.id,p.kind,p.area,p.category_key,p.activity_key,p.title,p.description,p.province_id,p.city_id,p.locality_label,
      p.status,p.status_reason,p.created_at,p.submitted_at,p.published_at,p.visible_until,p.edit_of,
      l.price_mode,l.price_cents,l.price_negotiable,l.attributes,b.business_type,e.starts_at,e.ends_at,e.timezone,
      s.slug,d.data presentation,d.contacts contact_details,c.channels
      from private.posts p left join private.listing_details l on l.post_id=p.id left join private.business_details b on b.post_id=p.id
      left join private.event_details e on e.post_id=p.id left join private.post_slugs s on s.post_id=p.id
      left join private.post_presentations d on d.post_id=p.id left join private.post_contacts c on c.post_id=p.id
      where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('post_reviews',$q$select m.post_id,m.edit_id,m.decision,m.reason,m.decided_at,m.price_only
      from private.moderation_log m join private.posts p on p.id=m.post_id where p.owner_id=$1 order by m.decided_at,m.id$q$),
    ('media_metadata',$q$select id,kind,size_bytes,mime,width,height,state,created_at,deleted_at from private.media_objects where owner_id=$1 order by created_at,id$q$),
    ('payments',$q$select p.id,p.product_kind,p.target_post_id,p.amount_cents,p.currency,p.status,p.fulfillment_status,p.merchant_reference,
      p.provider,p.created_at,p.completed_at,coalesce((p.snapshot->>'renewal')::boolean,false) renewal,
      p.snapshot->'cooling_off_consent' cooling_off_consent,p.snapshot->'renewal_starts' renewal_starts,
      (select jsonb_agg(jsonb_build_object('line_number',l.line_number,'amount_cents',l.amount_cents,'status',l.status,
          'renews_entitlement_id',l.renews_entitlement_id,'slot_count',l.slot_count,'reversal_kind',l.reversal_kind,
          'reversed_at',l.reversed_at)
        order by l.line_number) from private.payment_lines l where l.payment_id=p.id) lines
      from private.payments p where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('invoices',$q$select i.id,i.payment_id,i.invoice_number,i.amount_ex_vat_cents,i.vat_cents,i.total_cents,i.description,i.issued_at
      from private.invoices i join private.payments p on p.id=i.payment_id where p.owner_id=$1 order by i.issued_at,i.id$q$),
    ('customer_invoices',$q$select i.invoice_number,i.status,i.description,i.slots,i.unit_price_cents,i.total_cents,i.issued_at,i.due_on,
      i.buyer_name,i.buyer_address,i.buyer_registration_number,i.buyer_saved_at,i.cooling_off_consent_at,i.cooling_off_consent_version,
      i.payment_id,i.paid_at,i.voided_at,(select array_agg(l.payment_id order by l.attempt) from private.customer_invoice_payments l
        where l.invoice_id=i.id) payment_attempts
      from private.customer_invoices i where i.account_id=$1 order by i.issued_at,i.id$q$),
    ('bank_transfers',$q$select t.id,t.payment_id,v.duration_days term_days,t.slots,t.amount_received_cents,t.bank_reference,t.cleared_on,
      t.cooling_off_waiver_confirmed,t.status,t.recorded_at,t.confirmed_at,t.declined_at,t.expired_at
      from private.invoice_transfers t join private.plan_versions v on v.id=t.plan_version_id where t.account_id=$1 order by t.recorded_at,t.id$q$),
    ('entitlements',$q$select id,source,area,slot_capacity,activations_per_period,activation_period_days,max_photos,max_videos,starts_at,ends_at,status,revoked_reason,
      renews_entitlement_id,slot_id,package_id
      from private.entitlements where owner_id=$1 order by created_at,id$q$),
    ('house_slot_events',$q$select h.entitlement_id,h.action,h.ends_at,h.recorded_at from private.house_slot_events h
      join private.entitlements e on e.id=h.entitlement_id where e.owner_id=$1 order by h.recorded_at,h.id$q$),
    ('slot_packages',$q$select id,term_days,slot_count,created_at from private.slot_packages where owner_id=$1
      order by created_at,id$q$),
    ('package_invoice_requests',$q$select r.id,r.term_days,r.slots,r.unit_price_cents,r.total_cents,r.requested_at,r.consent_at,
      r.consent_version,r.status,r.closed_at,(select i.invoice_number from private.customer_invoices i where i.id=r.invoice_id) invoice_number
      from private.package_invoice_requests r where r.account_id=$1 order by r.requested_at,r.id$q$),
    ('post_activations',$q$select post_id,entitlement_id,activated_at,released_at,release_reason,continued
      from private.post_activations where owner_id=$1 order by activated_at,id$q$),
    ('event_submissions',$q$select post_id,submitted_at,released_at,release_reason
      from private.event_submissions where owner_id=$1 order by submitted_at,id$q$),
    ('introductory_trials',$q$select post_id,trial_entitlement_id,claimed_at,converted_at
      from private.post_trial_claims where owner_id=$1 order by claimed_at,post_id$q$),
    ('posting_terms',$q$select version,document_hash,accepted_at from private.posting_terms_acceptances where owner_id=$1 order by accepted_at,version$q$),
    ('signup_terms',$q$select version,document_hash,method,accepted_at from private.signup_terms_acceptances where account_id=$1$q$),
    ('communication_choices',$q$select purpose,granted,wording_version,recorded_at from private.communication_choice_events
      where account_id=$1 order by recorded_at,id$q$),
    ('verification_cases',$q$select id,kind,status,created_at from private.evidence_cases where subject_id=$1 order by created_at,id$q$),
    ('verification_reviews',$q$select r.case_id,r.reason,r.decision,r.created_at from private.verification_return_requests r join private.evidence_cases c on c.id=r.case_id
      where c.subject_id=$1 order by r.created_at,r.id$q$),
    ('evidence_metadata',$q$select id,case_id,purpose,state,size_bytes,created_at,retain_until,deleted_at
      from private.evidence_artifacts where owner_id=$1 order by created_at,id$q$),
    ('phone_verification',$q$select phone,verified_at,contact_changed_at,revoked_at from private.verification_phone_proofs where owner_id=$1 order by verified_at,id$q$),
    ('locality_verification',$q$select province_id,city_id,assurance,confirmed_at from private.verification_localities where owner_id=$1$q$),
    ('enquiries_sent',$q$select id,post_id,message,created_at from private.enquiries where sender_account_id=$1 order by created_at,id$q$),
    ('enquiries_received',$q$select id,post_id,message,status,created_at from private.enquiries where owner_id=$1 order by created_at,id$q$),
    ('notifications',$q$select id,kind,post_id,created_at,read_at from private.notifications where account_id=$1 order by created_at,id$q$),
    ('reports_submitted',$q$select id,post_id,coalesce(frontend_reason,category) category,description,status,created_at,resolved_at
      from private.reports where reporter_id=$1 order by created_at,id$q$),
    ('moderation_decisions',$q$select id,kind,reason,starts_at,ends_at,active from private.frontend_appealable_actions
      where account_id=$1 order by starts_at,id$q$),
    ('appeals',$q$select id,action_id,kind,reason,status,reviewer_rationale,created_at,resolved_at from private.frontend_appeals
      where appellant_id=$1 order by created_at,id$q$),
    ('organisation_applications',$q$select id,organisation_id,programme_id,post_id,reason,member_reference,share_representative_name,consented_at,
      status,info_request,info_response,decision_at,decision_note,created_at from private.organisation_applications where applicant_id=$1 order by created_at,id$q$),
    ('organisation_affiliations',$q$select a.id,a.organisation_id,a.programme_id,a.post_id,a.affiliation_type,a.status,a.confirmed_at,a.revoked_at,a.revoke_reason
      from private.organisation_affiliations a join private.posts p on p.id=a.post_id where p.owner_id=$1 order by a.created_at,a.id$q$),
    ('organisation_roles',$q$select organisation_id,role,created_at from private.organisation_admins where account_id=$1 order by created_at,organisation_id$q$),
    ('sponsorships',$q$select id,organisation_id,post_id,sponsor_type,status,starts_at,ends_at,ended_at,end_reason
      from private.organisation_sponsorships where owner_id=$1 order by created_at,id$q$),
    ('partner_account',$q$select id,code,status,commission_bps,created_at,updated_at from private.partners where account_id=$1 order by created_at,id$q$),
    ('partner_commissions',$q$select c.id,c.base_cents,c.rate_bps,c.amount_cents,c.status,c.eligible_at,c.approved_at,c.paid_at,c.reversed_at
      from private.partner_commissions c join private.partners p on p.id=c.partner_id where p.account_id=$1 order by c.created_at,c.id$q$),
    ('acquisition',$q$select source,campaign,landing_path,referrer_host,first_touch_at,recorded_at from private.account_acquisitions where account_id=$1$q$),
    ('account_closure',$q$select closed_at,evidence_delete_after from private.account_closures where user_id=$1$q$),
    ('data_requests',$q$select id,type,description,status,received_at,due_by,extended_due_at,extension_reason,response_summary,completed_at
      from private.privacy_requests where subject_user_id=$1 order by received_at,id$q$)
  ) as registry(dataset,statement) loop
    execute 'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb),count(*) from ('||entry.statement||' limit 2501)x'
      into items,row_count using p_subject;
    size_so_far:=size_so_far+octet_length(items::text);
    if row_count>2500 or size_so_far>4194304 then raise exception 'privacy export exceeds the direct delivery limit' using errcode='PT413';end if;
    result:=result||jsonb_build_object(entry.dataset,items);
  end loop;
  return result;
end$function$;
alter function internal.frontend_privacy_export_data(uuid) owner to postgres;
revoke all on function internal.frontend_privacy_export_data(uuid) from public;

CREATE OR REPLACE FUNCTION internal.run_retention(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  perform pg_catalog.set_config('vm.retention','on',true);
  perform internal.purge_frontend_post_commands(p_limit);perform internal.purge_frontend_post_actions(p_limit); result:=jsonb_build_object(
    'accounts',internal.run_account_erasures(least(p_limit,20)),
    'privacy_requests',internal.retention_privacy_requests(p_limit),
    'inbox',internal.purge_expired_inbox(p_limit),
    'identity_bans',internal.purge_expired_identity_bans(p_limit),
    'trial_identities',internal.purge_expired_trial_identities(p_limit),
    'verification',internal.retention_verification(p_limit),
    'staff_records',internal.retention_staff_records(p_limit),
    'commerce',internal.retention_commerce(p_limit),
    'operations',internal.retention_operations(p_limit));
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$function$;
alter function internal.run_retention(integer) owner to postgres;
revoke all on function internal.run_retention(integer) from public;
grant execute on function internal.run_retention(integer) to service_role;

CREATE OR REPLACE FUNCTION internal.erase_closed_account(p_user uuid, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare er private.account_erasures; reason text; earlier_retention text; counts jsonb := '{}'::jsonb; n integer;
begin
  if p_user is null or p_by is null or p_by not in ('staff', 'sweep') then
    raise exception 'account and erasing party required' using errcode = '22023';
  end if;
  perform internal.lock_evidence_subject(p_user);
  select * into er from private.account_erasures e where e.user_id = p_user for update;
  if not found then raise exception 'account is not closed' using errcode = 'PT404', detail = 'account_not_closed'; end if;
  if er.erased_at is not null or er.erase_after > statement_timestamp() then
    return internal.account_erasure_state(p_user);
  end if;
  reason := internal.account_erasure_hold(p_user);
  if reason is not null then
    update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = reason
      where user_id = p_user;
    return internal.account_erasure_state(p_user);
  end if;
  earlier_retention := coalesce(pg_catalog.current_setting('vm.retention', true), '');
  perform pg_catalog.set_config('vm.retention', 'on', true);
  perform pg_catalog.set_config('vm.erasure', p_user::text, true);

  select count(*) into n from private.enquiries q where q.owner_id = p_user or q.sender_account_id = p_user;
  counts := counts || jsonb_build_object('enquiries', n);
  -- Enquiries the account sent, with the other owner's notice and email.
  with gone as (
    delete from private.enquiries q where q.sender_account_id = p_user returning q.id
  ), notices as (
    delete from private.notifications x using gone where x.kind = 'enquiry_received' and x.subject_id = gone.id
  )
  delete from private.outbox_events o using gone where o.kind = 'enquiry_received' and o.subject_id = gone.id;
  -- Sponsored places first: deleting a place returns its grant.
  delete from private.organisation_sponsorships s where s.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('sponsored_places', n);
  -- Posts, with their edit copies, contacts, media links, search documents,
  -- received enquiries and everything else that belongs to a post.
  delete from private.posts p where p.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('posts', n);
  delete from private.event_submissions e where e.owner_id = p_user;
  delete from private.enquiries q where q.owner_id = p_user;
  delete from private.notifications x where x.account_id = p_user;
  delete from private.outbox_events o where o.owner_id = p_user;
  delete from private.profiles x where x.account_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('profile', n);
  delete from private.frontend_form_drafts d where d.owner_id = p_user;
  delete from private.listing_price_drafts d where d.owner_id = p_user;
  delete from private.intro_trial_requests t where t.owner_id = p_user;
  delete from private.frontend_business_checks b where b.owner_id = p_user;
  delete from private.organisation_admins a where a.account_id = p_user;
  delete from private.organisation_applications a where a.applicant_id = p_user;
  delete from private.entitlement_members m where m.member_id = p_user or m.added_by = p_user
    or m.entitlement_id in (select e.id from private.entitlements e where e.owner_id = p_user);
  delete from private.frontend_post_commands c where c.owner_id = p_user;
  delete from private.frontend_post_action_receipts r where r.owner_id = p_user;
  delete from private.account_acquisitions a where a.account_id = p_user;
  delete from private.communication_choice_events c where c.account_id = p_user;
  delete from private.signup_terms_acceptances a where a.account_id = p_user;
  delete from private.posting_terms_acceptances a where a.owner_id = p_user;
  delete from private.verification_localities l where l.owner_id = p_user;
  -- Photos and videos nothing kept still uses: queued for deletion from
  -- storage now (the media cleanup job deletes the objects).
  update private.media_objects m set state = 'cleanup_required', cleanup_lease_until = null
    where m.owner_id = p_user and m.state in ('intent', 'ready', 'rejected') and not internal.media_object_in_use(m.id);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('media_queued', n);

  -- Paid time ends; payment records stay for their tax years, no longer
  -- linked to the account.
  update private.entitlements e set status = 'revoked', revoked_reason = 'account_erased'
    where e.owner_id = p_user and e.status <> 'revoked';
  update private.trial_identities t set owner_id = null, entitlement_id = null,
      detached_at = er.closed_at, retain_until = er.closed_at + interval '3 years'
    where t.owner_id = p_user;
  update private.post_activations a set owner_id = null where a.owner_id = p_user;
  update private.entitlements e set owner_id = null where e.owner_id = p_user;
  update private.payments p set owner_id = null where p.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('payments_unlinked', n);
  update private.customer_invoices i set account_id = null where i.account_id = p_user;
  update private.invoice_transfers t set account_id = null where t.account_id = p_user;
  update private.payment_refund_requests r set account_id = null where r.account_id = p_user;
  update private.partner_commissions c set referred_account_id = null where c.referred_account_id = p_user;
  update private.individual_slot_limits l set account_id = null where l.account_id = p_user;
  update private.slot_packages k set owner_id = null where k.owner_id = p_user;
  -- Package invoice requests (20261119025106): an open one is withdrawn (it
  -- leaves the staff queue), then every one is kept unlinked like its invoice.
  update private.package_invoice_requests r set status = 'withdrawn', closed_at = statement_timestamp()
    where r.account_id = p_user and r.status in ('requested', 'awaiting_approval');
  update private.package_invoice_requests r set account_id = null where r.account_id = p_user;

  perform internal.remove_account_sign_in(p_user);
  perform pg_catalog.set_config('vm.erasure', '', true);
  perform pg_catalog.set_config('vm.retention', earlier_retention, true);
  update private.account_erasures set erased_at = statement_timestamp(), erased_by = p_by, erased_counts = counts,
      blocked_at = null, blocked_reason = null, auth_checked_at = statement_timestamp()
    where user_id = p_user;
  -- Deleting the Auth user never undoes the finished erasure: a failure is
  -- recorded and the daily check tries again.
  begin
    if internal.remove_erased_auth_user(p_user) then
      update private.account_erasures set auth_removed_at = statement_timestamp() where user_id = p_user;
    end if;
  exception when others then
    update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = 'error',
        blocked_detail = sqlstate
      where user_id = p_user;
  end;
  return internal.account_erasure_state(p_user);
end;
$function$;
alter function internal.erase_closed_account(uuid,text) owner to postgres;
revoke all on function internal.erase_closed_account(uuid,text) from public;

drop function api.record_post_views(uuid[],uuid,uuid);
drop function internal.record_post_views(uuid[],uuid,uuid);
drop function api.set_post_like(uuid,uuid,uuid,boolean,timestamptz);
drop function internal.set_post_like(uuid,uuid,uuid,boolean,timestamptz);
drop function api.get_post_engagement(uuid[]);
drop function internal.get_post_engagement(uuid[]);
drop function internal.purge_post_engagement();
drop table private.post_likes;
drop function internal.post_likes_count();
drop table private.post_engagement_totals;
drop table private.post_view_days;
drop table private.post_view_marks;
drop table private.post_view_salts;
drop table private.engagement_keys;
delete from private.cost_alarms a where a.metric in ('post_views_counted', 'post_likes_new');
delete from private.cost_allowances a where a.metric in ('post_views_counted', 'post_likes_new');

notify pgrst,'reload schema';
commit;
