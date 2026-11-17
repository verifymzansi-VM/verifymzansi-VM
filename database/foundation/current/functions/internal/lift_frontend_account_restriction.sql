-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lift_frontend_account_restriction(p_restriction uuid, p_expected_version integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');subject uuid;review_reason text;
  x private.frontend_account_restrictions;d private.decisions;binding private.identity_ban_bindings;replacement private.identity_ban_bindings;
begin
  review_reason:=internal.retention_reason(p_reason);
  select account_id into subject from private.frontend_account_restrictions where id=p_restriction;
  if not found then raise exception 'restriction unavailable' using errcode='PT409';end if;
  perform internal.lock_verification_subject(subject);
  select * into x from private.frontend_account_restrictions where id=p_restriction for update;
  select * into d from private.decisions where id=x.decision_id;
  actor:=internal.staff_actor('account:restore');
  if actor in(subject,d.proposed_by,d.approved_by,x.reporter_id) then raise exception 'independent restriction lift required' using errcode='42501';end if;
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 then raise exception 'represented restriction version required' using errcode='22023';end if;
  if x.lifted_at is not null then
    if x.lifted_by=actor and x.lift_reason=review_reason and x.version=p_expected_version+1 then return jsonb_build_object('restriction_id',x.id,'status','lifted','reused',true);end if;
    raise exception 'restriction lift changed' using errcode='PT409';
  end if;
  if x.version<>p_expected_version or x.ends_at<=clock_timestamp() then raise exception 'restriction changed or expired' using errcode='PT409';end if;
  update private.frontend_account_restrictions set version=version+1,lifted_at=clock_timestamp(),lifted_by=actor,lift_reason=review_reason where id=x.id;
  if x.kind='ban' then
    select * into binding from private.identity_ban_bindings where decision_id=d.id;
    if found then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(binding.identity_hmac,2701));
      if exists(select 1 from private.banned_identities b where b.identity_hmac=binding.identity_hmac and b.decision_id=d.id) then
        select i.* into replacement from private.identity_ban_bindings i join private.decisions other on other.id=i.decision_id
          where i.identity_hmac=binding.identity_hmac and i.decision_id<>d.id and i.retain_until>clock_timestamp() and other.status='approved'
          and not exists(select 1 from private.frontend_account_restrictions r where r.decision_id=other.id and not r.emergency and r.lifted_at is not null)
          order by i.approved_at desc,i.decision_id desc limit 1;
        if found then
          update private.banned_identities b set decision_id=replacement.decision_id,category=replacement.category,banned_at=replacement.approved_at,retain_until=replacement.retain_until
            where b.identity_hmac=binding.identity_hmac and b.decision_id=d.id;
        else delete from private.banned_identities b where b.identity_hmac=binding.identity_hmac and b.decision_id=d.id;end if;
      end if;
    end if;
  end if;
  perform internal.staff_actor('account:restore');return jsonb_build_object('restriction_id',x.id,'status','lifted');
end$function$;
alter function internal.lift_frontend_account_restriction(uuid,integer,text) owner to postgres;
revoke all on function internal.lift_frontend_account_restriction(uuid,integer,text) from public;
grant execute on function internal.lift_frontend_account_restriction(uuid,integer,text) to authenticated;
