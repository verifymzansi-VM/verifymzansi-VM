-- Generated filename by installed Supabase CLI; reviewed additive foundation repair.
-- Local artifact only. Apply before the matching app, after release approval.
begin;
do $repair$ begin
  if not exists(select 1 from pg_proc where oid=to_regprocedure('internal.billing_catalogue()') and md5(replace(prosrc,E'\r\n',E'\n')) in('6cbf43accffec093a29e925181bd7c53','f0c5673fcf9b37b603eac1866472e3d8')) then raise exception 'Unexpected foundation function: internal.billing_catalogue'; end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('internal.complete_evidence_upload(uuid,text,text,integer)') and md5(replace(prosrc,E'\r\n',E'\n')) in('fe432c30927427e3a051de7704ee4121','4ee99e8aba3021a021f9a52d05936083')) then raise exception 'Unexpected foundation function: internal.complete_evidence_upload'; end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('internal.claim_evidence_cleanup(integer)') and md5(replace(prosrc,E'\r\n',E'\n')) in('5019e56c95e632c5c39413e18777236c','7b3da1337260bcd71a5c9f2fd55480a5')) then raise exception 'Unexpected foundation function: internal.claim_evidence_cleanup'; end if;
end; $repair$;
create or replace function internal.billing_catalogue()
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.plan_code, 'label', p.label,
        'area', p.area, 'price_cents', p.price_cents::text, 'currency', p.currency, 'duration_days', p.duration_days,
        'activation_period_days', p.activation_period_days, 'activations_per_period', p.activations_per_period,
        'slot_capacity', p.slot_capacity, 'max_photos', p.max_photos, 'max_videos', p.max_videos,
        'addon_capabilities',to_jsonb(p.addon_capabilities))
        order by p.price_cents, p.plan_code)
      from private.plan_versions p where p.is_public and p.retired_at is null), '[]'),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'days', a.days,
        'price_cents', a.price_cents::text, 'currency', a.currency) order by a.kind, a.days)
      from private.addon_versions a where a.retired_at is null), '[]'));
$$;

create or replace function internal.complete_evidence_upload(p_artifact uuid,p_stored_sha256 text,p_content_sha256 text,p_size integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare completed jsonb;
begin
  if p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'content receipt required' using errcode='22023'; end if;
  perform internal.advance_evidence_artifact(p_artifact,'uploaded',p_stored_sha256,p_size);
  update private.evidence_artifacts set content_sha256=p_content_sha256 where id=p_artifact and (content_sha256 is null or content_sha256=p_content_sha256);
  if not found then raise exception 'content receipt changed' using errcode='PT409'; end if;
  completed:=internal.advance_evidence_artifact(p_artifact,'clean',p_stored_sha256,p_size);
  -- The artifact transitions increment the case revision. Return the revision
  -- while their subject/case locks are still held; never reuse the pre-upload one.
  return completed||jsonb_build_object('case_version',(
    select c.version from private.evidence_cases c join private.evidence_artifacts a on a.case_id=c.id
    where a.id=p_artifact));
end;
$$;

create or replace function internal.claim_evidence_cleanup(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb:='[]'::jsonb; candidate record; art private.evidence_artifacts; token uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1 to 100' using errcode='22023'; end if;
  for candidate in select a.id,a.owner_id,a.case_id from private.evidence_artifacts a
    where ((a.state='intent' and a.created_at<statement_timestamp()-interval '1 hour')
      or (a.state in('uploaded','clean','rejected') and coalesce(a.retain_until,a.created_at+interval '90 days')<=statement_timestamp())
      or (a.state='cleanup_required' and coalesce(a.cleanup_lease_until,'-infinity'::timestamptz)<=statement_timestamp()))
      -- Filter holds before the batch limit, and check them again under locks.
      -- Otherwise a held prefix can starve every later unheld artifact forever.
      and not exists(select 1 from private.legal_holds h where h.subject_id=a.owner_id and h.released_at is null)
      and not internal.evidence_fraud_held(a.case_id)
    order by a.owner_id,a.case_id,a.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    perform c.id from private.evidence_cases c where c.id=candidate.case_id for update skip locked;
    if not found then continue; end if;
    select a.* into art from private.evidence_artifacts a where a.id=candidate.id for update skip locked;
    if not found then continue; end if;
    if exists(select 1 from private.legal_holds h where h.subject_id=art.owner_id and h.released_at is null)
      or internal.evidence_fraud_held(art.case_id) then continue; end if;
    if not ((art.state='intent' and art.created_at<statement_timestamp()-interval '1 hour')
      or (art.state in('uploaded','clean','rejected') and coalesce(art.retain_until,art.created_at+interval '90 days')<=statement_timestamp())
      or (art.state='cleanup_required' and coalesce(art.cleanup_lease_until,'-infinity'::timestamptz)<=statement_timestamp())) then continue; end if;
    token:=pg_catalog.gen_random_uuid();
    update private.evidence_artifacts set state='cleanup_required',cleanup_token=token,cleanup_lease_until=statement_timestamp()+interval '5 minutes' where id=art.id;
    rows:=rows||jsonb_build_array(jsonb_build_object('artifact_id',art.id,'object_key',art.object_key,'claim_token',token,'lease_until',statement_timestamp()+interval '5 minutes'));
  end loop;
  return rows;
end;
$$;

commit;
