-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_queue_subject(p_subject text, p_id uuid, OUT post_id uuid, OUT report_id uuid)
 RETURNS record
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare original_id uuid;
begin
  if p_subject = 'post' then
    select p.edit_of into original_id from private.posts p where p.id = p_id;
    if original_id is not null then
      perform 1 from private.posts p where p.id = original_id for update;
    end if;
    select p.id into post_id from private.posts p
      where p.id = p_id and p.status = 'pending_moderation' and p.edit_of is not distinct from original_id for update;
    if post_id is null then raise exception 'item is not awaiting review' using errcode = '22023'; end if;
  elsif p_subject = 'report' then
    select r.id into report_id from private.reports r where r.id = p_id and r.status = 'open' and not internal.current_report_proposal(r.active_proposal_id) for update;
    if report_id is null then raise exception 'item is not awaiting review' using errcode = '22023'; end if;
  else
    raise exception 'unknown queue item' using errcode = '22023';
  end if;
end;
$function$;
alter function internal.lock_queue_subject(text,uuid) owner to postgres;
revoke all on function internal.lock_queue_subject(text,uuid) from public;
