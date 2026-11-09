-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_form_draft(p_flow text, p_action text, p_step integer DEFAULT NULL::integer, p_data jsonb DEFAULT NULL::jsonb, p_expected_account uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();stamp timestamptz;draft jsonb;
begin
  if p_expected_account is not null and p_expected_account<>actor
    then raise exception 'draft account changed' using errcode='42501';end if;
  if p_flow is null or p_flow not in('listing','business','promotion') or p_action is null or p_action not in('read','save','discard')
    then raise exception 'valid draft flow and action required' using errcode='22023';end if;
  if p_action='read' then
    select jsonb_build_object('step',d.step,'data',d.data,'saved_at',d.saved_at) into draft
      from private.frontend_form_drafts d where d.owner_id=actor and d.flow=p_flow and d.expires_at>clock_timestamp();
    perform internal.price_draft_actor();
    return jsonb_build_object('draft',draft);
  end if;
  perform internal.lock_evidence_subject(actor);
  perform internal.price_draft_actor();
  if p_action='discard' then
    delete from private.frontend_form_drafts where owner_id=actor and flow=p_flow;
  else
    if p_step is null or p_step<0 or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>65536
      then raise exception 'valid draft data required' using errcode='22023';end if;
    stamp:=clock_timestamp();
    insert into private.frontend_form_drafts(owner_id,flow,step,data,saved_at,expires_at)
      values(actor,p_flow,p_step,p_data,stamp,stamp+interval '14 days')
      on conflict(owner_id,flow) do update set step=excluded.step,data=excluded.data,
        saved_at=excluded.saved_at,expires_at=excluded.expires_at;
  end if;
  perform internal.price_draft_actor();
  return jsonb_build_object('ok',true);
end$function$;
alter function internal.frontend_form_draft(text,text,integer,jsonb,uuid) owner to postgres;
revoke all on function internal.frontend_form_draft(text,text,integer,jsonb,uuid) from public;
grant execute on function internal.frontend_form_draft(text,text,integer,jsonb,uuid) to authenticated;
