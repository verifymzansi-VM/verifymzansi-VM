-- Partner administration uses canonical partners, attribution and payment
-- records while retaining the selected partner panels and staff notes.
begin;
create table private.frontend_partner_notes(
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references private.partners(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  note text not null check(length(note) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp()
);
create index frontend_partner_notes_partner_idx on private.frontend_partner_notes(partner_id,created_at);
create index frontend_partner_notes_actor_idx on private.frontend_partner_notes(actor_id);
alter table private.frontend_partner_notes enable row level security;
revoke all on private.frontend_partner_notes from public,anon,authenticated,service_role;

create function internal.save_frontend_partner(p_account uuid,p_action text,p_reason text,p_code text default null,p_rate integer default null,p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('partner:manage');note_text text;result jsonb;
begin
  if p_note is not null then note_text:=internal.privacy_text(p_note,1,1000);end if;
  result:=internal.staff_save_partner(p_account,p_action,upper(p_code),p_rate,p_reason);
  if note_text is not null then
    insert into private.frontend_partner_notes(partner_id,actor_id,note) values((result->>'id')::uuid,actor,note_text);
  end if;
  perform internal.staff_actor('partner:manage');return result;
end$$;
create function api.save_frontend_partner(p_account uuid,p_action text,p_reason text,p_code text default null,p_rate integer default null,p_note text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.save_frontend_partner(p_account,p_action,p_reason,p_code,p_rate,p_note)$$;

create function internal.get_frontend_partner_admin()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('partner:manage');result jsonb;
begin
  select jsonb_build_object('actor_id',actor,'default_rate_bps',2000,
    'partners',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
      select p.id,p.account_id,p.code,p.status,p.commission_bps,p.created_at,pr.display_name,
        (select count(*) from private.account_acquisitions a where a.partner_id=p.id) referrals
      from private.partners p left join private.profiles pr on pr.account_id=p.account_id order by p.created_at desc,p.id desc limit 500)x),'[]'::jsonb),
    'commissions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
      select c.id,c.partner_id,p.code partner_code,c.base_cents::text,c.amount_cents::text,c.rate_bps,c.status,c.eligible_at,c.created_at,pay.status payment_status
      from private.partner_commissions c join private.partners p on p.id=c.partner_id
      join private.payments pay on pay.id=c.payment_id order by c.created_at desc,c.id desc limit 200)x),'[]'::jsonb)
  ) into result;
  perform internal.staff_actor('partner:manage');return result;
end$$;
create function api.get_frontend_partner_admin()
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_partner_admin()$$;

do $$declare signature text;ns text;begin
  foreach signature in array array['save_frontend_partner(uuid,text,text,text,integer,text)','get_frontend_partner_admin()'] loop
    foreach ns in array array['api','internal'] loop
      execute format('revoke all on function %I.%s from public,anon,authenticated,service_role',ns,signature);
      execute format('grant execute on function %I.%s to authenticated',ns,signature);
    end loop;
  end loop;
end$$;
notify pgrst,'reload schema';
commit;
