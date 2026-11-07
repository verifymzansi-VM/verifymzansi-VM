-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_owner_post_contacts(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'kind',p.kind,'status',p.status,'revision',p.revision,
    'edit_of',p.edit_of,'channels',to_jsonb(c.channels),
    'phone_ready',exists(select 1 from private.verification_phone_proofs f
      where f.owner_id=actor and f.revoked_at is null)) into result
  from private.posts p left join private.post_contacts c on c.post_id=p.id
  where p.id=p_post_id and p.owner_id=actor and p.kind in ('listing','event');
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_owner_post_contacts(uuid) owner to postgres;
revoke all on function internal.get_owner_post_contacts(uuid) from public;
grant execute on function internal.get_owner_post_contacts(uuid) to authenticated;
