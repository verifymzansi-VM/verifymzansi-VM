-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.release_frontend_content_hold(p_hold uuid, p_expected_version integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('content:restore');target uuid;subject uuid;h private.frontend_content_holds;
  post private.posts;state private.frontend_post_hold_state;review_reason text;did_restore boolean:=false;
  funded timestamptz;
begin
  review_reason:=internal.retention_reason(p_reason);
  select x.post_id,x.account_id into target,subject from private.frontend_content_holds x where x.id=p_hold;
  if not found then raise exception 'content hold unavailable' using errcode='PT409';end if;
  perform internal.lock_verification_subject(subject);
  select * into post from private.posts where id=target for update;
  select * into h from private.frontend_content_holds where id=p_hold for update;

  actor:=internal.staff_actor('content:restore');
  if actor=subject or actor=h.actor_id or actor=h.reporter_id then raise exception 'independent restoration reviewer required' using errcode='42501';end if;
  if h.released_at is not null then
    if h.released_by=actor and h.release_reason=review_reason and h.version=p_expected_version+1 then return jsonb_build_object('hold_id',h.id,'status','released','restored',h.restored,'reused',true);end if;
    raise exception 'content hold release changed' using errcode='PT409';
  end if;
  if h.version is distinct from p_expected_version or h.version>=2147483647 then raise exception 'represented content hold changed' using errcode='PT409';end if;
  update private.frontend_content_holds set version=version+1,released_at=clock_timestamp(),released_by=actor,release_reason=review_reason where id=h.id;
  if not exists(select 1 from private.frontend_content_holds x where x.post_id=target and x.released_at is null) then
    -- A paid post whose slot ran on in a renewal while it was held
    -- (20261114093742): its end date first catches up with the slot's run,
    -- so it is restored (or kept) with the days it has, not expired at once.
    if post.kind<>'event' then
      select max(f.funded_until) into funded from internal.post_funding(target) f;
      if funded>clock_timestamp() and post.visible_until is distinct from funded then
        update private.posts set visible_until=funded where id=target returning * into post;
        update private.post_search_documents set visible_until=funded where post_id=target;
      end if;
    end if;
    select * into state from private.frontend_post_hold_state where post_id=target for update;
    if post.status='paused' and post.status_reason='staff_hidden' and post.revision<2147483647 then
      if not state.content_changed and post.revision=state.hidden_revision and state.prior_status='live'
        and internal.current_verified_identity(subject) is not null and exists(select 1 from private.frontend_restorable_posts x where x.id=target) then
        update private.posts set status='live',status_reason=state.prior_reason,revision=revision+1 where id=target;
        perform internal.write_post_projection(target);did_restore:=true;
      else
        update private.posts set status_reason=case when state.prior_status='paused' then state.prior_reason else 'staff_review_cleared' end,revision=revision+1 where id=target;
      end if;
    end if;
    delete from private.frontend_post_hold_state where post_id=target;
  end if;
  update private.frontend_content_holds set restored=did_restore where id=h.id;
  perform internal.staff_actor('content:restore');
  return jsonb_build_object('hold_id',h.id,'status','released','restored',did_restore);
end$function$;
alter function internal.release_frontend_content_hold(uuid,integer,text) owner to postgres;
revoke all on function internal.release_frontend_content_hold(uuid,integer,text) from public;
grant execute on function internal.release_frontend_content_hold(uuid,integer,text) to authenticated;
