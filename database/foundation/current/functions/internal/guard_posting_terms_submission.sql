-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.guard_posting_terms_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare current_version text; current_hash text;
begin
  if new.status<>'pending_moderation' then return new; end if;
  if tg_op='UPDATE' then
    if old.status='pending_moderation' then return new; end if;
  end if;
  -- The submission kernel separately enforces fresh owner/session authority.
  -- This guard enforces consent for every transition into the review queue,
  -- including direct API alternatives, without trusting client booleans.
  select c.version into current_version from private.posting_terms_current c
    where c.singleton for share;
  if current_version is null then
    raise exception 'posting terms are not available' using errcode='PT503',detail='posting_terms_unavailable';
  end if;
  select v.document_hash into current_hash from private.posting_terms_versions v
    where v.version=current_version;
  if not exists(select 1 from private.posting_terms_acceptances a
      where a.owner_id=new.owner_id and a.version=current_version and a.document_hash=current_hash) then
    raise exception 'accept current posting terms before submitting' using errcode='PT409',detail='posting_terms_required';
  end if;
  return new;
end;
$function$;
alter function internal.guard_posting_terms_submission() owner to postgres;
revoke all on function internal.guard_posting_terms_submission() from public;
