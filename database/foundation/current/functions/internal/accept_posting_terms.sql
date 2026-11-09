-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.accept_posting_terms(p_version text, p_document_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); current_version text; current_hash text; accepted timestamptz;
begin
  -- Serialize acceptance with a policy switch, without taking post locks.
  select c.version into current_version from private.posting_terms_current c
    where c.singleton for share;
  perform internal.price_draft_actor();
  if current_version is null then
    raise exception 'posting terms are not available' using errcode='PT503',detail='posting_terms_unavailable';
  end if;
  select v.document_hash into current_hash from private.posting_terms_versions v
    where v.version=current_version;
  if p_version is distinct from current_version or p_document_hash is distinct from current_hash then
    raise exception 'posting terms changed; review the current document' using errcode='PT409',detail='posting_terms_changed';
  end if;
  insert into private.posting_terms_acceptances(owner_id,version,document_hash)
    values(actor,current_version,current_hash) on conflict(owner_id,version) do nothing;
  select a.accepted_at into accepted from private.posting_terms_acceptances a
    where a.owner_id=actor and a.version=current_version and a.document_hash=current_hash;
  perform internal.price_draft_actor();
  return jsonb_build_object('version',current_version,'document_hash',current_hash,
    'document_path','/terms/versions/'||current_version,'accepted_at',accepted);
end;
$function$;
alter function internal.accept_posting_terms(text,text) owner to postgres;
revoke all on function internal.accept_posting_terms(text,text) from public;
grant execute on function internal.accept_posting_terms(text,text) to authenticated;
