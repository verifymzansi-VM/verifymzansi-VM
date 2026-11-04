-- Existing edit forms have no new-consent checkbox. They may use an acceptance
-- already on record, and must never create one implicitly.
begin;
do $$declare before text; after text; begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.consume_frontend_post_command(uuid)'::regprocedure)
    <>'900b5850a8454a0f49d81097204a5fe9' then raise exception 'frontend post command drift'; end if;
  before:=replace(pg_get_functiondef('internal.consume_frontend_post_command(uuid)'::regprocedure),E'\r\n',E'\n');
  after:=replace(before,'perform internal.accept_posting_terms(input->''terms''->>''version'',input->''terms''->>''document_hash'');',
    'if input->>''target_id'' is null then
      if input->>''terms_accepted'' is distinct from ''true'' then raise exception ''explicit posting consent required'' using errcode=''22023''; end if;
      perform internal.accept_posting_terms(input->''terms''->>''version'',input->''terms''->>''document_hash'');
    else
      if not exists(select 1 from private.posting_terms_current c join private.posting_terms_versions v on v.version=c.version
        join private.posting_terms_acceptances a on a.owner_id=actor and a.version=v.version and a.document_hash=v.document_hash
        where v.version=input->''terms''->>''version'' and v.document_hash=input->''terms''->>''document_hash'') then
        raise exception ''review and accept the current posting terms before editing'' using errcode=''PT409'',detail=''posting_terms_required''; end if;
    end if;');
  if after=before then raise exception 'posting consent anchor missing'; end if;execute after;
end$$;
commit;
