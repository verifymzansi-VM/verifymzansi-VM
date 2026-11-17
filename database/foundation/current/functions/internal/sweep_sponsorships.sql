-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.sweep_sponsorships(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare s record; o record; ended integer:=0; started integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'limit 1 to 1000' using errcode='22023'; end if;
  for s in select x.id,x.organisation_id,
        case when exists(select 1 from private.current_account_access u where u.id=x.owner_id)
          then 'ended' else 'revoked' end as next_status
      from private.organisation_sponsorships x join private.organisations g on g.id=x.organisation_id
      where x.status='active' and (x.ends_at<=statement_timestamp() or g.programme_ends_at<=statement_timestamp()
        or not exists(select 1 from private.current_account_access u where u.id=x.owner_id))
      order by x.ends_at,x.id limit p_limit loop
    perform 1 from private.organisations g where g.id=s.organisation_id for update;
    if internal.finish_sponsorship(s.id,s.next_status,
        case s.next_status when 'ended' then 'Sponsorship period ended' else 'Owner account unavailable' end,null) then
      ended:=ended+1; end if;
  end loop;
  for o in select g.id from private.organisations g
      where g.programme_status in('founding_trial','active_paid')
        and exists(select 1 from private.organisation_sponsorships w where w.organisation_id=g.id and w.status='waitlisted')
        and (select count(*) from private.organisation_sponsorships a where a.organisation_id=g.id
          and a.status='active')<g.sponsored_capacity
      order by g.id limit 100 loop
    perform 1 from private.organisations g where g.id=o.id for update;
    started:=started+internal.fill_sponsorship_places(o.id);
  end loop;
  return jsonb_build_object('ended',ended,'started',started);
end;
$function$;
alter function internal.sweep_sponsorships(integer) owner to postgres;
revoke all on function internal.sweep_sponsorships(integer) from public;
grant execute on function internal.sweep_sponsorships(integer) to service_role;
