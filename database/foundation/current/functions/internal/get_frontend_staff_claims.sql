-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_claims(p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');items jsonb;own_count bigint;
begin
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>300 then raise exception 'bounded claim subjects required' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object'
      or not(x ? 'type' and x ? 'id') or x-array['type','id']<>'{}'::jsonb
      or jsonb_typeof(x->'type') is distinct from 'string' or jsonb_typeof(x->'id') is distinct from 'string'
      or x->>'type' not in('report','verification_step','listing','business','promotion','content_edit','business_verification')
      or x->>'id' is null or x->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then
    raise exception 'typed claim subjects required' using errcode='22023';end if;
  with all_claims as(
    select coalesce(q.post_id,q.report_id) id,case when q.post_id is not null then 'post' else 'report' end subject,
      case when q.post_id is not null then 'content' else 'reports' end queue,
      case when q.report_id is not null then 'report' when p.edit_of is not null then 'content_edit' when p.kind='event' then 'promotion' else p.kind end item_type,
      q.claimed_by,q.claim_generation,q.claim_nonce,q.claim_expires_at,p.revision,p.edit_of
      from private.queue_claims q left join private.posts p on p.id=q.post_id
      where q.claimed_by is not null and q.claim_expires_at>clock_timestamp()
    union all
    select c.id,'case',case c.kind when 'kyc' then 'kyc' else 'business_kyc' end,
      case c.kind when 'kyc' then 'verification_step' else 'business_verification' end,
      c.claimed_by,c.claim_generation,c.claim_nonce,c.claim_expires_at,c.version,null::uuid
      from private.evidence_cases c where c.kind in('kyc','business') and c.status='open'
      and c.claimed_by is not null and c.claim_expires_at>clock_timestamp()
  ), selected as(
    select c.* from all_claims c where c.claimed_by=actor or exists(select 1 from jsonb_array_elements(p_items) x
      where x->>'type'=c.item_type and x->>'id'=c.id::text) order by c.subject,c.id limit 1301
  ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'subject',c.subject,'queue',c.queue,'item_type',c.item_type,
    'mine',c.claimed_by=actor,'holder_name',case when c.claimed_by=actor then 'you' else 'another moderator' end,
    'generation',case when c.claimed_by=actor then c.claim_generation::text end,
    'nonce',case when c.claimed_by=actor then c.claim_nonce end,
    'expires_at',c.claim_expires_at,'revision',c.revision,'edit_of',c.edit_of) order by c.subject,c.id),'[]'::jsonb),
    (select count(*) from all_claims c where c.claimed_by=actor) into items,own_count from selected c;
  if jsonb_array_length(items)>1300 then raise exception 'too many claim subjects; narrow this view' using errcode='PT409';end if;
  perform internal.staff_actor('queue:view');
  return jsonb_build_object('account_id',actor,'own_count',own_count,'items',items);
end$function$;
alter function internal.get_frontend_staff_claims(jsonb) owner to postgres;
revoke all on function internal.get_frontend_staff_claims(jsonb) from public;
grant execute on function internal.get_frontend_staff_claims(jsonb) to authenticated;
