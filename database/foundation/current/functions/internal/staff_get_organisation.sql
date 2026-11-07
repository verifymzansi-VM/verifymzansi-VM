-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_get_organisation(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage'); o private.organisations;
begin
  select * into o from private.organisations where id=p_id;
  if not found then return null; end if;
  return to_jsonb(o)-'created_by'-'logo_permission_by'||jsonb_build_object(
    'logo_object_key',(select m.object_key from private.media_objects m where m.id=o.logo_object_id),
    'admins',coalesce((select jsonb_agg(jsonb_build_object('account_id',a.account_id,'role',a.role,
      'display_name',p.display_name,'created_at',a.created_at) order by a.created_at)
      from private.organisation_admins a left join private.profiles p on p.account_id=a.account_id
      where a.organisation_id=o.id),'[]'),
    'open_invites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',internal.mask_email(i.email),
      'expires_at',i.expires_at) order by i.created_at) from private.organisation_invites i
      where i.organisation_id=o.id and i.accepted_at is null and i.revoked_at is null
        and i.expires_at>statement_timestamp()),'[]'),
    'programmes',coalesce((select jsonb_agg(jsonb_build_object('id',pr.id,'slug',pr.slug,'name',pr.name,
      'active',pr.active) order by pr.name) from private.organisation_programmes pr where pr.organisation_id=o.id),'[]'),
    'active_affiliations',(select count(*) from private.organisation_affiliations f
      where f.organisation_id=o.id and f.status='active'),
    'open_applications',(select count(*) from private.organisation_applications a
      where a.organisation_id=o.id and a.status in('submitted','more_info_required')),
    'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'created_at',n.created_at)
      order by n.created_at desc) from (select * from private.organisation_notes n where n.organisation_id=o.id
      order by n.created_at desc limit 50) n),'[]'));
end;
$function$;
alter function internal.staff_get_organisation(uuid) owner to postgres;
revoke all on function internal.staff_get_organisation(uuid) from public;
grant execute on function internal.staff_get_organisation(uuid) to authenticated;
