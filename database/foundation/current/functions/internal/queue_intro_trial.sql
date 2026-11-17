-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.queue_intro_trial(p_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); post private.posts; fingerprint text;
begin
  select * into post from private.posts p where p.id=p_post_id and p.owner_id=actor;
  if not found or post.kind='event' or post.edit_of is not null then
    raise exception 'post not found' using errcode='22023';
  end if;
  fingerprint:=internal.current_verified_identity(actor);
  if fingerprint is null then raise exception 'no active plan covers this post' using errcode='PT402'; end if;
  -- The same per-identity lock as internal.grant_intro_trial.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint,2701));
  -- The free week is used (a trial or a sponsored place holds the identity)
  -- or the identity is banned: no free week left.
  if exists(select 1 from private.trial_identities t where t.owner_id=actor or t.identity_hmac=fingerprint)
    or exists(select 1 from private.banned_identities b where b.identity_hmac=fingerprint and b.retain_until>clock_timestamp()) then
    raise exception 'no active plan covers this post' using errcode='PT402';
  end if;
  -- Its single slot: one post at a time waits for it.
  if internal.intro_trial_waiting(actor) then
    raise exception 'all posting capacity is in use' using errcode='PT409';
  end if;
  -- A slot whose plan has ended (activate_post's own release went with its PT402).
  update private.post_activations set released_at=statement_timestamp(),release_reason='entitlement_ended'
    where post_id=post.id and released_at is null;
  insert into private.intro_trial_requests(post_id,owner_id) values(post.id,actor)
    on conflict(post_id) do update set owner_id=excluded.owner_id,requested_at=excluded.requested_at;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
end;
$function$;
alter function internal.queue_intro_trial(uuid) owner to postgres;
revoke all on function internal.queue_intro_trial(uuid) from public;
