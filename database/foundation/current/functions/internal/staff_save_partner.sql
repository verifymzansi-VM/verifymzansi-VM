-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_save_partner(p_account uuid, p_action text, p_code text, p_commission_bps integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('partner:manage'); p private.partners;
begin
  perform internal.organisation_reason(p_reason);
  if p_account is null or p_account=actor then
    raise exception 'staff cannot manage their own partner record' using errcode='42501',detail='self_partner'; end if;
  perform internal.lock_verification_subject(p_account);
  select * into p from private.partners x where x.account_id=p_account for update;
  actor:=internal.staff_actor('partner:manage');
  if p_commission_bps is not null and p_commission_bps not between 0 and 5000 then
    raise exception 'invalid rate' using errcode='22023',detail='partner_invalid'; end if;
  if p_action='create' then
    if p.id is not null then raise exception 'already a partner' using errcode='PT409',detail='partner_exists'; end if;
    if p_code is null or p_code !~ '^[A-Z0-9]{4,16}$' then
      raise exception 'invalid code' using errcode='22023',detail='partner_invalid'; end if;
    if not exists(select 1 from private.current_account_access u where u.id=p_account) then
      raise exception 'account unavailable' using errcode='PT409',detail='partner_account_unavailable'; end if;
    if exists(select 1 from private.partners x where x.code=p_code) then
      raise exception 'code taken' using errcode='PT409',detail='partner_code_taken'; end if;
    insert into private.partners(account_id,code,commission_bps,created_by) values(p_account,p_code,p_commission_bps,actor)
      returning * into p;
  elsif p.id is null then
    raise exception 'partner not found' using errcode='PT404',detail='partner_unavailable';
  elsif p_action='activate' then
    if internal.current_verified_identity(p_account) is null then
      raise exception 'verified identity required' using errcode='PT409',detail='verification_required'; end if;
    update private.partners set status='active',revision=revision+1,updated_at=statement_timestamp()
      where id=p.id returning * into p;
  elsif p_action='suspend' then
    update private.partners set status='suspended',revision=revision+1,updated_at=statement_timestamp()
      where id=p.id returning * into p;
  elsif p_action='set_rate' then
    update private.partners set commission_bps=p_commission_bps,revision=revision+1,updated_at=statement_timestamp()
      where id=p.id returning * into p;
  else
    raise exception 'unknown action' using errcode='22023',detail='partner_invalid';
  end if;
  insert into private.partner_events(partner_id,actor_id,action,reason) values(p.id,actor,'partner_'||p_action,p_reason);
  return jsonb_build_object('id',p.id,'code',p.code,'status',p.status,'commission_bps',p.commission_bps,
    'revision',p.revision);
end;
$function$;
alter function internal.staff_save_partner(uuid,text,text,integer,text) owner to postgres;
revoke all on function internal.staff_save_partner(uuid,text,text,integer,text) from public;
grant execute on function internal.staff_save_partner(uuid,text,text,integer,text) to authenticated;
