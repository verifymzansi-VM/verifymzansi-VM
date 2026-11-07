-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_identity_ban(p_decision_id uuid, p_identity_hmac text, p_category text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare ban private.banned_identities; decision private.decisions; deadline timestamptz;
begin
  if p_identity_hmac is null or p_identity_hmac !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' then
    raise exception 'identity fingerprint required' using errcode='22023';
  end if;
  if p_category is null or p_category not in('fraud','fake_listings','harassment','impersonation','repeat_abuse','other') then
    raise exception 'ban category required' using errcode='22023';
  end if;
  select d.* into decision from private.decisions d where d.id=p_decision_id and d.status='approved' and d.action='restrict_account';
  if not found then raise exception 'an approved account restriction is required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_identity_hmac,2701));
  if exists(select 1 from private.frontend_account_restrictions x where x.decision_id=decision.id and not x.emergency and x.lifted_at is not null) then raise exception 'this report ban was lifted' using errcode='PT409';end if;
  select b.* into ban from private.banned_identities b where b.identity_hmac=p_identity_hmac for update;
  if found and ban.decision_id=p_decision_id then
    if ban.category is distinct from p_category then raise exception 'conflicting ban retry' using errcode='PT409'; end if;
    return jsonb_build_object('banned',ban.retain_until>clock_timestamp(),'retain_until',ban.retain_until);
  end if;
  if ban.identity_hmac is not null and decision.approved_at<ban.banned_at then
    raise exception 'restriction event is older than current ban' using errcode='PT409';
  end if;
  -- Retention starts at the approved restriction event, never its retry or a
  -- delayed callback. Replaying an already-expired event cannot resurrect it.
  deadline:=decision.approved_at+interval '5 years';
  if deadline<=clock_timestamp() then return jsonb_build_object('banned',false,'retain_until',deadline); end if;
  insert into private.banned_identities(identity_hmac,decision_id,category,banned_at,retain_until)
  values(p_identity_hmac,p_decision_id,p_category,decision.approved_at,deadline)
  on conflict(identity_hmac) do update set decision_id=excluded.decision_id,category=excluded.category,
    banned_at=excluded.banned_at,retain_until=excluded.retain_until returning * into ban;
  return jsonb_build_object('banned',true,'retain_until',ban.retain_until);
end;
$function$;
alter function internal.record_identity_ban(uuid,text,text) owner to postgres;
revoke all on function internal.record_identity_ban(uuid,text,text) from public;
