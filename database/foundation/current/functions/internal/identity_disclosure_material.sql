-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_disclosure_material(p_disclosure uuid, p_staff uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare d private.identity_disclosures; records jsonb:='[]'::jsonb;
begin
  if p_disclosure is null or p_staff is null then
    raise exception 'disclosure and staff member required' using errcode='22023'; end if;
  d:=internal.identity_disclosure_open_for(p_disclosure,p_staff,null);
  if d.outcome='record' then
    select coalesce(jsonb_agg(x.material order by u.ord),'[]'::jsonb) into records
      from unnest(d.subject_ids) with ordinality u(subject,ord)
      cross join lateral (select jsonb_build_object('account_id',f.owner_id,'submission_id',s.id,
          'encrypted_number',case when s.number_erased_at is null then jsonb_build_object('ciphertext',s.number_ciphertext,
            'iv',s.number_iv,'tag',s.number_tag,'key_id',s.encryption_key_id) end,
          'selfie',case when a.state in ('uploaded','clean') and a.sha256 is not null and a.size_bytes is not null
            then jsonb_build_object('artifact_id',a.id,'case_id',a.case_id,'object_key',a.object_key,
              'sha256',a.sha256,'size_bytes',a.size_bytes) end) material
        from private.accepted_identity_facts f
        join private.verification_identity_submissions s on s.id=f.submission_id and s.owner_id=f.owner_id
        left join private.evidence_artifacts a on a.id=s.selfie_artifact_id
        where f.owner_id=u.subject
        order by f.reviewed_at desc, f.id desc limit 1) x;
  end if;
  return jsonb_build_object('disclosure_id',d.id,'records',records);
end;
$function$;
alter function internal.identity_disclosure_material(uuid,uuid) owner to postgres;
revoke all on function internal.identity_disclosure_material(uuid,uuid) from public;
grant execute on function internal.identity_disclosure_material(uuid,uuid) to service_role;
