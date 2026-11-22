-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_disclosure_record(p_disclosure private.identity_disclosures, p_subject uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p_disclosure.request_type='urgent_life_risk' then rec.r - 'selfie' - 'id_photo' else rec.r end
  from (select case when p_disclosure.outcome='attempt_only' then jsonb_build_object(
      'account_id',p_subject,'kept',false,
      'attempts',coalesce((select jsonb_agg(t.created_at order by t.created_at desc)
        from (select x.created_at from private.verification_identity_submissions x
          where x.owner_id=p_subject and x.identity_hmac=p_disclosure.lookup_value
            and p_disclosure.request_type is distinct from 'urgent_life_risk'
          order by x.created_at desc limit 20) t),'[]'::jsonb))
    else coalesce((select jsonb_build_object(
      'account_id',p_subject,'kept',true,
      'account_closed_at',(select c.closed_at from private.account_closures c where c.user_id=p_subject),
      'legal_first_name',coalesce(n.legal_first_name,case when p.legal_name_fact_id=f.id then p.legal_first_name end),
      'legal_last_name',coalesce(n.legal_last_name,case when p.legal_name_fact_id=f.id then p.legal_last_name end),
      'verified_at',f.reviewed_at,
      'verification_revoked_at',f.revoked_at,
      'checked_by',case s.recipe when 'manual-id-selfie-v1' then 'staff_review' else 'other' end,
      'id_number_kept',s.number_erased_at is null,
      'id_number_erased_at',s.number_erased_at,
      'selfie',jsonb_build_object('kept',coalesce(sa.state in ('uploaded','clean'),false),'taken_at',sa.created_at,
        'deleted_at',case when sa.state not in ('uploaded','clean') then coalesce(sa.deleted_at,sa.state_changed_at) end),
      'id_photo',jsonb_build_object('kept',coalesce(ia.state in ('uploaded','clean'),false),'taken_at',ia.created_at,
        'deleted_at',case when ia.state not in ('uploaded','clean') then coalesce(ia.deleted_at,ia.state_changed_at) end),
      'phones',coalesce((select jsonb_agg(jsonb_build_object('phone',v.phone,'verified_at',v.verified_at,
          'revoked_at',v.revoked_at) order by v.verified_at desc)
        from (select y.phone,y.verified_at,y.revoked_at from private.verification_phone_proofs y
          where y.owner_id=p_subject
            and (p_disclosure.request_type is distinct from 'urgent_life_risk' or y.revoked_at is null)
          order by y.verified_at desc limit 20) v),'[]'::jsonb))
      from private.accepted_identity_facts f
      join private.verification_identity_submissions s on s.id=f.submission_id and s.owner_id=f.owner_id
      left join private.identity_submission_names n on n.submission_id=s.id
      left join private.profiles p on p.account_id=f.owner_id
      left join private.evidence_artifacts sa on sa.id=s.selfie_artifact_id
      left join private.evidence_artifacts ia on ia.id=s.id_artifact_id
      where f.owner_id=p_subject
      order by f.reviewed_at desc, f.id desc limit 1),
      jsonb_build_object('account_id',p_subject,'kept',false,
        'account_closed_at',(select c.closed_at from private.account_closures c where c.user_id=p_subject)))
  end r) rec;
$function$;
alter function internal.identity_disclosure_record(private.identity_disclosures,uuid) owner to postgres;
revoke all on function internal.identity_disclosure_record(private.identity_disclosures,uuid) from public;
