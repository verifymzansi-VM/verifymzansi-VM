-- The selected edit forms save non-live content; the existing Resubmit or
-- Reactivate controls then submit it. Only edits to live content create and
-- submit a review copy immediately.
begin;
do $$declare before text;after text;begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.consume_frontend_post_command(uuid)'::regprocedure)<>'bdd78c33317706838618bb9f673b0a68' then raise exception 'non-live edit command drift';end if;
  before:=replace(pg_get_functiondef('internal.consume_frontend_post_command(uuid)'::regprocedure),E'\r\n',E'\n');
  after:=replace(before,'wants_edit boolean:=false;','wants_edit boolean:=false;original_status text;');
  after:=replace(after,'if post.status=''live'' then','original_status:=post.status; if post.status=''live'' then');
  after:=replace(after,'elsif post.status not in(''draft'',''rejected'',''paused'') then',
    'elsif post.status in(''expired'',''sold'') then update private.posts set status=''paused'',revision=revision+1 where id=post.id returning * into post;
     elsif post.status not in(''draft'',''rejected'',''paused'') then');
  after:=replace(after,'  begin
    answer:=internal.submit_post(post.id,rev);',
    '  if input->>''target_id'' is not null and not wants_edit then
       if original_status in(''expired'',''sold'') then update private.posts set status=original_status,revision=revision+1 where id=post.id returning revision into rev;end if;
       answer:=jsonb_build_object(''id'',post.id,''status'',original_status,''revision'',rev);
     else begin
    answer:=internal.submit_post(post.id,rev);');
  after:=replace(after,'  answer:=answer||jsonb_build_object(''original_id'',', '  end if; answer:=answer||jsonb_build_object(''original_id'',');
  if after=before or position('original_status text;' in after)=0 or position('else begin' in after)=0 then raise exception 'non-live edit anchors missing';end if;execute after;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.frontend_owner_post(uuid,uuid)'::regprocedure)<>'80c3f1ba1c051681f8aec7201fcbb9a5' then raise exception 'pending funding projection drift';end if;
  before:=replace(pg_get_functiondef('internal.frontend_owner_post(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  after:=replace(before,'''expires_at'',coalesce(p.visible_until,(select f.funded_until from internal.post_funding(p.id) f)),',
    '''expires_at'',case when p.status=''pending_moderation'' then (select f.funded_until from internal.post_funding(p.id) f) else coalesce(p.visible_until,(select f.funded_until from internal.post_funding(p.id) f)) end,');
  if after=before then raise exception 'pending funding projection anchor missing';end if;execute after;
end$$;
commit;
