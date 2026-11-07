-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.manage_plan_member(p_entitlement_id uuid, p_action text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); ent private.entitlements; target uuid;
begin
  if p_action not in ('add','remove') or length(btrim(coalesce(p_email,''))) not between 3 and 254 then
    raise exception 'invalid member command' using errcode='22023'; end if;
  select * into ent from private.entitlements e where e.id=p_entitlement_id and e.owner_id=actor for update;
  if not found or ent.slot_capacity<2 or ent.source<>'retail_paid' or ent.status<>'active' or ent.ends_at<=clock_timestamp()
    or internal.current_verified_identity(actor) is null then raise exception 'shared plan unavailable' using errcode='42501'; end if;
  select u.id into target from auth.users u where lower(u.email)=lower(btrim(p_email))
    and u.email_confirmed_at is not null and u.id<>actor
    and exists(select 1 from private.current_account_access a where a.id=u.id)
    and internal.current_verified_identity(u.id) is not null;
  if target is null then raise exception 'verified member unavailable' using errcode='22023'; end if;
  if p_action='remove' then delete from private.entitlement_members where entitlement_id=ent.id and member_id=target;
  else
    if not exists(select 1 from private.entitlement_members where entitlement_id=ent.id and member_id=target)
      and exists(select 1 from private.entitlement_members where entitlement_id=ent.id) then
      raise exception 'shared plan member limit reached' using errcode='PT409'; end if;
    insert into private.entitlement_members(entitlement_id,member_id,added_by) values(ent.id,target,actor) on conflict do nothing;
  end if;
  perform internal.price_draft_actor();
  return jsonb_build_object('success',true);
end;
$function$;
alter function internal.manage_plan_member(uuid,text,text) owner to postgres;
revoke all on function internal.manage_plan_member(uuid,text,text) from public;
grant execute on function internal.manage_plan_member(uuid,text,text) to authenticated;
