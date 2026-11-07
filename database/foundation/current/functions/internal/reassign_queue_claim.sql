-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reassign_queue_claim(p_subject text, p_id uuid, p_to uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('queue:reassign'); s record; c private.queue_claims; reason text; previous uuid;
begin
  reason := internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb, to_jsonb(p_reason)) #>> '{}';
  if reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode = '22023';
  end if;
  -- The new holder's guard comes first, as in claim acquisition, so the cap
  -- check below cannot race the holder's own claims or another reassignment.
  if p_to is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_to::text, 1201));
  end if;
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  c := internal.lock_queue_claim(s.post_id, s.report_id);
  actor := internal.staff_actor('queue:reassign');
  if internal.queue_conflict(actor, s.post_id, s.report_id) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  if c.id is null or c.claimed_by is null or c.claim_expires_at <= clock_timestamp() then
    raise exception 'nobody holds this item' using errcode = 'PT409';
  end if;
  previous := c.claimed_by;
  if p_to is null then
    update private.queue_claims set claimed_by = null, claim_nonce = null, claimed_at = null,
      claim_expires_at = null, renewals = 0
    where id = c.id;
  else
    if p_to = previous then raise exception 'that reviewer already holds this item' using errcode = '22023'; end if;
    if not exists (select 1 from private.staff_roles r join private.staff_capabilities k on k.role = r.role
        join private.current_account_access u on u.id = r.user_id
        where r.user_id = p_to and r.revoked_at is null and k.capability = 'queue:claim')
      or internal.queue_conflict(p_to, s.post_id, s.report_id) then
      raise exception 'choose an independent reviewer who works this queue' using errcode = '22023';
    end if;
    if (select count(*) from private.queue_claims q where q.claimed_by = p_to and q.claim_expires_at > clock_timestamp()) >= 20 then
      raise exception 'that reviewer already holds 20 items' using errcode = 'PT429';
    end if;
    update private.queue_claims set claimed_by = p_to, claim_generation = claim_generation + 1,
      claim_nonce = pg_catalog.gen_random_uuid(), claimed_at = clock_timestamp(),
      claim_expires_at = clock_timestamp() + interval '15 minutes', renewals = 0
    where id = c.id and claim_generation < 9223372036854775807 returning * into c;
    if c.id is null then raise exception 'claim generation exhausted' using errcode = 'PT409'; end if;
  end if;
  insert into private.queue_claim_events (post_id, report_id, actor_id, event, from_staff, to_staff, claim_generation, reason)
  values (s.post_id, s.report_id, actor, case when p_to is null then 'released_by_staff' else 'reassigned' end,
    previous, p_to, c.claim_generation, reason);
  return jsonb_build_object('subject', p_subject, 'id', p_id,
    'status', case when p_to is null then 'released' else 'reassigned' end, 'claim_generation', c.claim_generation::text);
end;
$function$;
alter function internal.reassign_queue_claim(text,uuid,uuid,text) owner to postgres;
revoke all on function internal.reassign_queue_claim(text,uuid,uuid,text) from public;
grant execute on function internal.reassign_queue_claim(text,uuid,uuid,text) to authenticated;
