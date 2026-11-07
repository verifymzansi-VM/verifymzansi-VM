-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.guard_frontend_offline_review_budget()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare snapshot private.frontend_post_approval_snapshots;price_only boolean;kind text;
begin
  if new.decision<>'approve' or new.edit_id is not null then return new;end if;
  select * into snapshot from private.frontend_post_approval_snapshots where post_id=new.post_id;
  if not found or snapshot.digest=internal.frontend_post_approval_digest(new.post_id) then return new;end if;
  select p.kind into kind from private.posts p where p.id=new.post_id;
  price_only:=kind='listing' and snapshot.structural_digest is not null and snapshot.structural_digest=internal.frontend_post_structural_digest(new.post_id);
  if price_only and internal.recent_price_change(new.post_id) then raise exception 'one approved price change per day' using errcode='PT429';end if;
  if not price_only and internal.approved_edit_count(new.post_id)>=internal.edit_allowance(new.post_id) then
    raise exception 'approved edit allowance reached' using errcode='PT409';end if;
  return new;
end$function$;
alter function internal.guard_frontend_offline_review_budget() owner to postgres;
revoke all on function internal.guard_frontend_offline_review_budget() from public;
