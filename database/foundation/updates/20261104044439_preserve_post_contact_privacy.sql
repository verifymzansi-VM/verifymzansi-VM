-- Keep private sellers' street addresses owner-only. Chosen business contact
-- channels remain public as in the selected frontend; their numbers confer no
-- account verification and are never returned for listings/events.
begin;
do $$declare before text;after text;begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.frontend_post_presentation(uuid)'::regprocedure)
    <>'8b33278f2b18d7646a959d692d509239' then raise exception 'presentation privacy definition drift'; end if;
  before:=replace(pg_get_functiondef('internal.frontend_post_presentation(uuid)'::regprocedure),E'\r\n',E'\n');
  after:=replace(before,'coalesce((select data from private.post_presentations where post_id=p_post),''{}''::jsonb)',
    'coalesce((select case when p.kind=''listing'' then d.data-''location_address'' else d.data end
      from private.post_presentations d join private.posts p on p.id=d.post_id where d.post_id=p_post),''{}''::jsonb)');
  if after=before then raise exception 'public privacy anchor missing'; end if;execute after;
  before:=replace(pg_get_functiondef('internal.frontend_post_presentation(uuid)'::regprocedure),E'\r\n',E'\n');
  after:=replace(before,'''[]''::jsonb));',
    '''[]''::jsonb)) || coalesce((select jsonb_build_object(''business_contacts'',d.contacts)
      from private.post_presentations d join private.posts p on p.id=d.post_id
      where d.post_id=p_post and p.kind=''business''),''{}''::jsonb);');
  if after=before then raise exception 'business contact anchor missing'; end if;execute after;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.frontend_owner_post(uuid,uuid)'::regprocedure)
    <>'12e3eb77e700aaf3b9a868da5cdbfe38' then raise exception 'owner privacy projection drift'; end if;
  before:=replace(pg_get_functiondef('internal.frontend_owner_post(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  after:=replace(before,'''frontend'',internal.frontend_post_presentation(p.id),',
    '''frontend'',jsonb_set(internal.frontend_post_presentation(p.id),''{data}'',coalesce((select data from private.post_presentations where post_id=p.id),''{}''::jsonb)),');
  if after=before then raise exception 'owner privacy anchor missing'; end if;execute after;
end$$;
commit;
