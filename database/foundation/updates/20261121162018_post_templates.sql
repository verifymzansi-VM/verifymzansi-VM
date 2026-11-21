-- Post templates (launch checklist item 17b, business tools plan section 4,
-- approved by the owner on 20 November 2026 with all 10 recommendations).
--
-- A member whose Multi-listing package is running saves a reusable starting
-- point for Market listings and starts a new post from it. A template keeps
-- only what the plan lists: the category, the details that repeat (never the
-- year or the mileage), the description, the location and which contact
-- buttons to show. Never photos, video, title, price or numbers.
--
-- From this update:
-- 1. private.post_templates: up to 20 per account, each with a name unique per
--    account (ignoring case) and its form fields (data, at most 16 KiB).
--    Deleted when the account closes (trigger on private.account_closures)
--    and with the Auth user.
-- 2. api.save_my_post_template(name, data) (members): saves a template, or
--    replaces the one with the same name ("save again under the same name").
--    Only while the caller's Multi-listing package runs (PT402, detail
--    package_required); a 21st template is refused (PT429, detail
--    template_limit). A name that is empty, longer than 60 characters or holds
--    a control character is refused (22023, detail template_name_invalid);
--    data with any other field, an empty category, a detail that is not text,
--    yes/no or a list of text, a price detail or a detail of one item (see the
--    list in the command) or an unknown contact button is refused (22023,
--    detail template_invalid).
-- 3. api.list_my_post_templates() (members): the caller's templates and
--    whether their package runs.
-- 4. api.rename_my_post_template(template, name) and
--    api.delete_my_post_template(template) (members): the caller's own
--    templates only (PT404, detail template_unavailable); a name already used
--    is refused (PT409, detail template_name_taken). Allowed after the package
--    ends, so a member can always tidy up their own data.
-- 5. The privacy export gains the dataset post_templates.
--
-- Package teams (P4c, item 15) are not built: a template belongs to the
-- account that made it. When teams exist, the plan lets the whole team use a
-- template and only its maker or the owner rename or delete it.
--
-- Expand only: four new API commands, a new table, a trigger; the privacy
-- export gains one dataset. No command, argument or grant changes. ORDER:
-- website first: the website calls the new commands only while
-- SHOW_POST_TEMPLATES is on (off until launch switch-on), and the staff access
-- export (/api/admin/dsar/export) accepts at least the live number of datasets
-- (42), so it takes the 43rd once this update is applied.
-- Read-only preflight: ../preflight/20261121162018_post_templates.check.sql.
-- Rollback: ../rollback/20261121162018_post_templates.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: the replaced function has its reviewed body (or this
-- update's), and the new pieces are all absent or all present.
do $$
declare present integer;
begin
  select (to_regclass('private.post_templates') is not null)::integer
    + (to_regprocedure('internal.save_my_post_template(text,jsonb)') is not null)::integer
    + (to_regprocedure('api.save_my_post_template(text,jsonb)') is not null)::integer
    + (to_regprocedure('internal.list_my_post_templates()') is not null)::integer
    + (to_regprocedure('api.list_my_post_templates()') is not null)::integer
    + (to_regprocedure('internal.rename_my_post_template(uuid,text)') is not null)::integer
    + (to_regprocedure('api.rename_my_post_template(uuid,text)') is not null)::integer
    + (to_regprocedure('internal.delete_my_post_template(uuid)') is not null)::integer
    + (to_regprocedure('api.delete_my_post_template(uuid)') is not null)::integer
    + (to_regprocedure('internal.clear_closed_account_post_templates()') is not null)::integer
  into present;
  if present not in (0, 10) then
    raise exception 'post templates precondition: % of 10 new pieces exist', present using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.frontend_privacy_export_data(uuid)'))
      not in ('e543b105fe264d5a683b5c570bf68cb5', 'ab02f76bb5bb62b58521df6d584cf93b') then
    raise exception 'post templates precondition: internal.frontend_privacy_export_data is not the reviewed body' using errcode='55000';
  end if;
end$$;

-- 1. The templates.
create table if not exists private.post_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'listing' check (kind = 'listing'),
  name text not null check (char_length(name) >= 1 and char_length(name) <= 60),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 16384),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create unique index if not exists post_templates_owner_name_key on private.post_templates(owner_id, lower(name));
alter table private.post_templates owner to postgres;
alter table private.post_templates enable row level security;
revoke all on private.post_templates from public, anon, authenticated, service_role;

-- 2. Save a template, or replace the one with the same name.
create or replace function internal.save_my_post_template(p_name text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.price_draft_actor(); clean text := btrim(p_name); saved private.post_templates;
  replaced boolean; bad boolean;
begin
  if clean is null or char_length(clean) not between 1 and 60 or clean ~ '[[:cntrl:]]' then
    raise exception 'template name 1 to 60 characters' using errcode='22023', detail='template_name_invalid'; end if;
  -- Only the fields the plan keeps: no photos, video, title, prices, numbers
  -- or details that belong to one item (year, mileage, colour and the like);
  -- details are text, yes/no or lists of text; contact buttons by name only.
  -- Checked in steps, so each step only reads a shape the one before allowed.
  bad := jsonb_typeof(p_data) is distinct from 'object';
  if not bad then
    bad := octet_length(p_data::text) > 16384
      or jsonb_typeof(p_data->'category') is distinct from 'string' or p_data->>'category' = ''
      or exists(select 1 from jsonb_each(p_data) f where f.key not in
        ('category','condition','categoryAttributes','description','province','city','town','address','contactMethods')
        or (f.key not in ('categoryAttributes','contactMethods') and jsonb_typeof(f.value) <> 'string'))
      or jsonb_typeof(coalesce(p_data->'categoryAttributes', '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(p_data->'contactMethods', '[]'::jsonb)) <> 'array';
  end if;
  if not bad then
    bad := coalesce(p_data->'categoryAttributes', '{}'::jsonb) ?| array['year','mileage_km','number_of_owners',
        'battery_health_pct','colour','accident_free','registration_province','available_from',
        'application_deadline','age_months','quantity','monthly_rent_zar','salary_min','salary_max','levy_zar',
        'rates_taxes_zar']
      or exists(select 1 from jsonb_each(coalesce(p_data->'categoryAttributes', '{}'::jsonb)) a
        where case jsonb_typeof(a.value) when 'string' then false when 'boolean' then false
          when 'array' then exists(select 1 from jsonb_array_elements(a.value) e where jsonb_typeof(e) <> 'string')
          else true end)
      or exists(select 1 from jsonb_array_elements(coalesce(p_data->'contactMethods', '[]'::jsonb)) c
        where c not in ('"call"','"whatsapp"','"in_app"'));
  end if;
  if bad then
    raise exception 'template details invalid' using errcode='22023', detail='template_invalid'; end if;
  perform internal.lock_evidence_subject(actor);
  if not exists(select 1 from internal.slot_package_now(actor)) then
    raise exception 'templates need a running Multi-listing package' using errcode='PT402', detail='package_required'; end if;
  update private.post_templates t set name = clean, data = p_data, updated_at = statement_timestamp()
    where t.owner_id = actor and lower(t.name) = lower(clean)
    returning * into saved;
  replaced := found;
  if not replaced then
    if (select count(*) from private.post_templates t where t.owner_id = actor) >= 20 then
      raise exception 'up to 20 templates' using errcode='PT429', detail='template_limit'; end if;
    insert into private.post_templates(owner_id, name, data) values (actor, clean, p_data) returning * into saved;
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', saved.id, 'name', saved.name, 'replaced', replaced);
end;
$$;
alter function internal.save_my_post_template(text, jsonb) owner to postgres;

-- 3. My templates, and whether my package runs.
create or replace function internal.list_my_post_templates()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.price_draft_actor();
begin
  return jsonb_build_object(
    'package_running', exists(select 1 from internal.slot_package_now(actor)),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'name', t.name,
        'data', t.data, 'updated_at', t.updated_at) order by lower(t.name), t.id)
      from private.post_templates t where t.owner_id = actor), '[]'::jsonb));
end;
$$;
alter function internal.list_my_post_templates() owner to postgres;

-- 4. Rename or delete one of my templates.
create or replace function internal.rename_my_post_template(p_template uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.price_draft_actor(); clean text := btrim(p_name); renamed uuid;
begin
  if clean is null or char_length(clean) not between 1 and 60 or clean ~ '[[:cntrl:]]' then
    raise exception 'template name 1 to 60 characters' using errcode='22023', detail='template_name_invalid'; end if;
  perform internal.lock_evidence_subject(actor);
  if exists(select 1 from private.post_templates t where t.owner_id = actor and lower(t.name) = lower(clean)
      and t.id is distinct from p_template) then
    raise exception 'template name already used' using errcode='PT409', detail='template_name_taken'; end if;
  update private.post_templates t set name = clean, updated_at = statement_timestamp()
    where t.id = p_template and t.owner_id = actor returning t.id into renamed;
  if renamed is null then
    raise exception 'template unavailable' using errcode='PT404', detail='template_unavailable'; end if;
  perform internal.price_draft_actor();
  return jsonb_build_object('id', renamed, 'name', clean);
end;
$$;
alter function internal.rename_my_post_template(uuid, text) owner to postgres;

create or replace function internal.delete_my_post_template(p_template uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.price_draft_actor(); gone uuid;
begin
  perform internal.lock_evidence_subject(actor);
  delete from private.post_templates t where t.id = p_template and t.owner_id = actor returning t.id into gone;
  if gone is null then
    raise exception 'template unavailable' using errcode='PT404', detail='template_unavailable'; end if;
  perform internal.price_draft_actor();
  return jsonb_build_object('id', gone);
end;
$$;
alter function internal.delete_my_post_template(uuid) owner to postgres;

create or replace function api.save_my_post_template(p_name text, p_data jsonb)
returns jsonb
language sql
set search_path to 'pg_catalog'
as $$
  select internal.save_my_post_template(p_name, p_data);
$$;
create or replace function api.list_my_post_templates()
returns jsonb
language sql
set search_path to 'pg_catalog'
as $$
  select internal.list_my_post_templates();
$$;
create or replace function api.rename_my_post_template(p_template uuid, p_name text)
returns jsonb
language sql
set search_path to 'pg_catalog'
as $$
  select internal.rename_my_post_template(p_template, p_name);
$$;
create or replace function api.delete_my_post_template(p_template uuid)
returns jsonb
language sql
set search_path to 'pg_catalog'
as $$
  select internal.delete_my_post_template(p_template);
$$;
alter function api.save_my_post_template(text, jsonb) owner to postgres;
alter function api.list_my_post_templates() owner to postgres;
alter function api.rename_my_post_template(uuid, text) owner to postgres;
alter function api.delete_my_post_template(uuid) owner to postgres;
revoke all on function internal.save_my_post_template(text, jsonb), api.save_my_post_template(text, jsonb),
  internal.list_my_post_templates(), api.list_my_post_templates(),
  internal.rename_my_post_template(uuid, text), api.rename_my_post_template(uuid, text),
  internal.delete_my_post_template(uuid), api.delete_my_post_template(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.save_my_post_template(text, jsonb), api.save_my_post_template(text, jsonb),
  internal.list_my_post_templates(), api.list_my_post_templates(),
  internal.rename_my_post_template(uuid, text), api.rename_my_post_template(uuid, text),
  internal.delete_my_post_template(uuid), api.delete_my_post_template(uuid)
  to authenticated;

-- 1. Templates go when the account closes (and with the Auth user).
create or replace function internal.clear_closed_account_post_templates()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
begin
  delete from private.post_templates where owner_id = new.user_id;
  return null;
end;
$$;
alter function internal.clear_closed_account_post_templates() owner to postgres;
revoke all on function internal.clear_closed_account_post_templates() from public, anon, authenticated, service_role;
create or replace trigger post_templates_account_closed after insert on private.account_closures
  for each row execute function internal.clear_closed_account_post_templates();

-- 5. REPLACE: internal.frontend_privacy_export_data (gains post_templates).
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
    ('post_templates',$q$select id,kind,name,data,created_at,updated_at from private.post_templates where owner_id=$1 order by created_at,id$q$),
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
      r.consent_version,r.status,r.closed_at,(select i.invoice_number from private.customer_invoices i where i.id=r.invoice_id) invoice_number,
      r.kind,r.package_id,r.days_left,r.invoiced_days
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
    ('post_likes',$q$select l.post_id,l.created_at from (select post_id,created_at,id from private.post_likes
      where account_id=$1 order by created_at desc,id limit 2000) l$q$),
    ('post_likes_summary',$q$select count(*) total,min(created_at) first_at,max(created_at) last_at
      from private.post_likes where account_id=$1$q$),
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

commit;
