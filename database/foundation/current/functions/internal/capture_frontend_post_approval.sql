-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.capture_frontend_post_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare snapshot private.frontend_post_approval_snapshots;digest text;structural text;kind text;
begin
  if new.decision='approve' and exists(select 1 from private.posts p where p.id=new.post_id and p.status='live' and p.edit_of is null) then
    select * into snapshot from private.frontend_post_approval_snapshots where post_id=new.post_id;
    digest:=internal.frontend_post_approval_digest(new.post_id);structural:=internal.frontend_post_structural_digest(new.post_id);
    select p.kind into kind from private.posts p where p.id=new.post_id;
    if snapshot.post_id is not null and snapshot.digest<>digest and new.edit_id is null then
      insert into private.frontend_offline_post_reviews(log_id,post_id,price_only,decided_at)
        values(new.id,new.post_id,kind='listing' and snapshot.structural_digest is not null and snapshot.structural_digest=structural,new.decided_at);
    end if;
    insert into private.frontend_post_approval_snapshots(post_id,digest,structural_digest,approved_at) values(new.post_id,digest,structural,new.decided_at)
      on conflict(post_id) do update set digest=excluded.digest,structural_digest=excluded.structural_digest,approved_at=excluded.approved_at;
  end if;return new;
end$function$;
alter function internal.capture_frontend_post_approval() owner to postgres;
revoke all on function internal.capture_frontend_post_approval() from public;
