-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_role_review(p_page integer DEFAULT 1, p_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('role:review');now_at timestamptz:=clock_timestamp();result jsonb;
begin
  if p_page is null or p_page not between 1 and 10000 or (p_role is not null and p_role not in('moderator','governor','admin'))
    then raise exception 'valid roster page required' using errcode='22023';end if;
  with roster as (
    select r.user_id,r.role,r.granted_at,r.frontend_mfa_not_before as mfa_required_after
    from private.staff_roles r where r.revoked_at is null and (p_role is null or r.role=p_role)
  ), staff as (
    select * from roster order by granted_at desc,user_id limit 50 offset (p_page-1)*50
  ), pending as (
    select id,target_id,from_role,to_role,proposer_id,reason,created_at,expires_at
      from private.frontend_staff_role_changes where status='proposed' and expires_at>now_at order by created_at,id limit 100
  ), history as (
    select id,target_id,from_role,to_role,reviewer_id,reason,decided_at
      from private.frontend_staff_role_changes where status='applied' order by decided_at desc,id desc limit 25
  ), involved as (
    select user_id from staff union select target_id from pending union select proposer_id from pending
      union select target_id from history union select reviewer_id from history
  )
  select jsonb_build_object('actor_id',actor,'staff_total',(select count(*) from roster),
    'staff',coalesce((select jsonb_agg(to_jsonb(s) order by granted_at desc,user_id) from staff s),'[]'::jsonb),
    'pending',coalesce((select jsonb_agg(to_jsonb(p) order by created_at,id) from pending p),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by decided_at desc,id desc) from history h),'[]'::jsonb),
    'people',coalesce((select jsonb_agg(jsonb_build_object('user_id',u.id,'email',u.email,'display_name',p.display_name))
      from involved i join auth.users u on u.id=i.user_id and u.deleted_at is null left join private.profiles p on p.account_id=u.id),'[]'::jsonb)
  ) into result;
  perform internal.staff_actor('role:review');return result;
end$function$;
alter function internal.get_frontend_staff_role_review(integer,text) owner to postgres;
revoke all on function internal.get_frontend_staff_role_review(integer,text) from public;
grant execute on function internal.get_frontend_staff_role_review(integer,text) to authenticated;
