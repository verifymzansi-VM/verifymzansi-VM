-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_phone_number_releases()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');now_at timestamptz:=clock_timestamp();
begin
  return jsonb_build_object('actor_id',actor,
    'pending',coalesce((select jsonb_agg(jsonb_build_object('phone',w.phone,'reason',w.release_reason,
        'proposed_at',w.release_proposed_at,'expires_at',w.release_proposed_at+interval '7 days',
        'proposed_by_name',internal.profile_public_name(p.display_name),
        'proposed_by_me',w.release_proposed_by is not distinct from actor,
        'conflicted',internal.phone_release_conflict(actor,w.phone)) order by w.release_proposed_at desc,w.phone)
      from (select distinct on(n.phone) n.phone,n.release_reason,n.release_proposed_by,n.release_proposed_at
          from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
          where n.released_at is null and b.retain_until>now_at and n.release_proposed_at>now_at-interval '7 days'
          order by n.phone,n.release_proposed_at desc) w
        left join private.profiles p on p.account_id=w.release_proposed_by),'[]'::jsonb),
    'released',coalesce((select jsonb_agg(jsonb_build_object('phone',r.phone,'reason',r.release_reason,
        'proposed_by_name',internal.profile_public_name(pp.display_name),
        'released_by_name',internal.profile_public_name(rp.display_name),
        'released_at',r.released_at) order by r.released_at desc,r.phone)
      from (select * from (select distinct on(n.phone) n.phone,n.release_reason,n.release_proposed_by,n.released_by,n.released_at
            from private.banned_phone_numbers n where n.released_at is not null
            order by n.phone,n.released_at desc) latest
          order by latest.released_at desc,latest.phone limit 50) r
        left join private.profiles pp on pp.account_id=r.release_proposed_by
        left join private.profiles rp on rp.account_id=r.released_by),'[]'::jsonb));
end$function$;
alter function internal.get_phone_number_releases() owner to postgres;
revoke all on function internal.get_phone_number_releases() from public;
grant execute on function internal.get_phone_number_releases() to authenticated;
