-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_identity_check(p_check uuid, p_session_id uuid, p_outcome text, p_reasons text[] DEFAULT '{}'::text[], p_id_front jsonb DEFAULT NULL::jsonb, p_selfie jsonb DEFAULT NULL::jsonb, p_identity jsonb DEFAULT NULL::jsonb, p_names jsonb DEFAULT NULL::jsonb, p_risk_score integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare k private.identity_checks; subject uuid; done jsonb; submitted jsonb; s private.verification_identity_submissions;
  setting_mode text; found_reasons text[]; now_at timestamptz;
begin
  if p_check is null or p_session_id is null or p_outcome is null
    or p_outcome not in('approved','declined','in_review','not_finished')
    or p_reasons is null
    or not (p_reasons <@ array['names_differ','document_not_accepted','id_number_invalid','under_18','session_moved']::text[]) then
    raise exception 'identity check result required' using errcode='22023'; end if;
  if (p_outcome='not_finished') <> (p_id_front is null and p_selfie is null and p_identity is null and p_names is null and p_risk_score is null)
    or (p_outcome<>'not_finished' and (jsonb_typeof(p_id_front) is distinct from 'object' or jsonb_typeof(p_selfie) is distinct from 'object'
      or jsonb_typeof(p_names) is distinct from 'object' or p_names-array['first_name','last_name']<>'{}'::jsonb
      or jsonb_typeof(p_names->'first_name') is distinct from 'string' or jsonb_typeof(p_names->'last_name') is distinct from 'string'
      or jsonb_typeof(p_identity) is distinct from 'object' or p_identity-array['fingerprint','encrypted_number']<>'{}'::jsonb
      or not(p_identity ?& array['fingerprint','encrypted_number'])
      or p_id_front-array['stored_sha256','content_sha256','size']<>'{}'::jsonb
      or p_selfie-array['stored_sha256','content_sha256','size']<>'{}'::jsonb
      or jsonb_typeof(p_id_front->'size') is distinct from 'number' or jsonb_typeof(p_selfie->'size') is distinct from 'number')) then
    raise exception 'identity check evidence required' using errcode='22023'; end if;
  select x.owner_id into subject from private.identity_checks x where x.id=p_check;
  if not found then raise exception 'identity check unavailable' using errcode='PT409'; end if;
  perform internal.lock_verification_subject(subject);
  select x.* into k from private.identity_checks x where x.id=p_check for update;
  if k.session_id is distinct from p_session_id then
    raise exception 'identity check session changed' using errcode='PT409'; end if;
  if k.status<>'started' then
    return jsonb_build_object('status',k.status,'submission_id',k.submission_id,'reused',true); end if;
  now_at:=clock_timestamp();
  if p_outcome='not_finished' or k.expires_at<=now_at then
    update private.identity_checks set status='not_finished',finished_at=now_at,reasons=p_reasons,provider_delete_due=now_at
      where id=k.id;
    return jsonb_build_object('status','not_finished','submission_id',null);
  end if;
  if k.id_artifact_id is null or k.selfie_artifact_id is null then
    raise exception 'identity check evidence was not reserved' using errcode='PT409'; end if;
  perform internal.complete_evidence_upload(k.id_artifact_id,p_id_front->>'stored_sha256',p_id_front->>'content_sha256',(p_id_front->>'size')::integer);
  done:=internal.complete_evidence_upload(k.selfie_artifact_id,p_selfie->>'stored_sha256',p_selfie->>'content_sha256',(p_selfie->>'size')::integer);
  submitted:=internal.register_identity_submission(k.case_id,(done->>'case_version')::integer,k.id_artifact_id,k.selfie_artifact_id,
    p_identity->>'fingerprint','identity-match-v1',p_identity->'encrypted_number',k.id,p_risk_score);
  select x.* into s from private.verification_identity_submissions x where x.id=(submitted->>'submission_id')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.identity_hmac,2701));
  select array_agg(r order by r) into found_reasons from (select distinct r from unnest(p_reasons
    ||case p_outcome when 'declined' then array['provider_declined'] when 'in_review' then array['provider_in_review'] else '{}'::text[] end
    ||case when exists(select 1 from private.identity_submission_names n where n.submission_id=s.id
      and n.legal_first_name=p_names->>'first_name' and n.legal_last_name=p_names->>'last_name') then '{}'::text[]
      else array['names_differ'] end
    ||case when exists(select 1 from private.banned_identities b where b.identity_hmac=s.identity_hmac
      and b.retain_until>clock_timestamp()) then array['banned'] else '{}'::text[] end
    ||case when exists(select 1 from private.accepted_identity_facts f where f.identity_hmac=s.identity_hmac
      and f.revoked_at is null) then array['duplicate'] else '{}'::text[] end
    ||case when s.risk_score>50 then array['high_risk'] else '{}'::text[] end) r) x;
  select x.mode into setting_mode from private.identity_check_settings x where x.id;
  now_at:=clock_timestamp();
  if setting_mode in('staff_final','automatic') and found_reasons is null then
    update private.identity_checks set status='approved',finished_at=now_at,submission_id=s.id where id=k.id;
    perform internal.accept_automatic_identity_submission(k.id,s.id);
  elsif setting_mode='automatic' then
    update private.identity_checks set reasons=found_reasons where id=k.id;
    perform internal.decline_automatic_identity_submission(k.id,s.id);
  else
    update private.identity_checks set status='with_staff',finished_at=now_at,submission_id=s.id,
      reasons=coalesce(found_reasons,'{}'::text[]) where id=k.id;
  end if;
  return jsonb_build_object('status',(select x.status from private.identity_checks x where x.id=k.id),'submission_id',s.id);
end$function$;
alter function internal.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) owner to postgres;
revoke all on function internal.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) from public;
grant execute on function internal.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) to service_role;
