-- Native support tickets and the provider outcomes shown by the selected inbox.
begin;
insert into private.staff_capabilities(role,capability,requires_recent_mfa) values
  ('admin','support:view',false),('moderator','support:view',false),('governor','support:view',false),
  ('admin','support:update',false),('moderator','support:update',false);
create table private.support_tickets(
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 2 and 100),
  email text not null check(length(email) between 3 and 254),
  category text not null check(category in('fraud_report','verification_appeal','privacy_popia','payment_refund','security_vulnerability','business_claim','organisation_proposal','general_support')),
  message text not null check(length(message) between 10 and 2000),
  status text not null default 'new' check(status in('new','in_progress','resolved')),
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default clock_timestamp()
);
create index support_tickets_queue_idx on private.support_tickets(created_at desc,id desc);
create index support_tickets_open_idx on private.support_tickets(created_at,id) where status='new';
create index support_tickets_sender_idx on private.support_tickets(email,created_at desc);
create table private.support_ticket_mail(
  ticket_id uuid not null references private.support_tickets(id) on delete cascade,
  template text not null check(template in('support_acknowledgement','support_staff_alert')),
  accepted boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(ticket_id,template)
);
create table private.support_ticket_events(
  ticket_id uuid not null references private.support_tickets(id) on delete cascade,
  revision integer not null check(revision>1),
  actor_id uuid references auth.users(id) on delete set null,
  status text not null check(status in('new','in_progress','resolved')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(ticket_id,revision)
);
create index support_ticket_events_actor_idx on private.support_ticket_events(actor_id);
alter table private.support_tickets enable row level security;
alter table private.support_ticket_mail enable row level security;
alter table private.support_ticket_events enable row level security;
revoke all on private.support_tickets,private.support_ticket_mail,private.support_ticket_events from public,anon,authenticated,service_role;

create function internal.submit_frontend_support(p_name text,p_email text,p_category text,p_message text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare sender text:=lower(btrim(p_email));sender_name text;body text;x private.support_tickets;now_at timestamptz;
begin
  if sender is null or length(sender)>254 or sender !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_category is null or p_category not in('fraud_report','verification_appeal','privacy_popia','payment_refund','security_vulnerability','business_claim','organisation_proposal','general_support')
    then raise exception 'check support recipient and category' using errcode='22023';end if;
  sender_name:=internal.privacy_text(p_name,2,100);body:=internal.privacy_text(p_message,10,2000);
  perform pg_advisory_xact_lock(hashtextextended(sender,6502));now_at:=clock_timestamp();
  select * into x from private.support_tickets t where t.email=sender and t.name=sender_name and t.category=p_category and t.message=body
    and t.created_at>now_at-interval '10 minutes' order by t.created_at desc,t.id desc limit 1;
  if found then
    return jsonb_build_object('id',x.id,'reused',true,'accepted',(select m.accepted from private.support_ticket_mail m
      where m.ticket_id=x.id and m.template='support_acknowledgement'));
  end if;
  insert into private.support_tickets(name,email,category,message) values(sender_name,sender,p_category,body) returning * into x;
  return jsonb_build_object('id',x.id,'reused',false,'accepted',null);
end$$;
create function api.submit_frontend_support(p_name text,p_email text,p_category text,p_message text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.submit_frontend_support(p_name,p_email,p_category,p_message)$$;

create function internal.record_frontend_support_mail(p_ticket uuid,p_template text,p_accepted boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
  insert into private.support_ticket_mail(ticket_id,template,accepted) values(p_ticket,p_template,p_accepted)
  on conflict(ticket_id,template) do nothing;
  return exists(select 1 from private.support_ticket_mail m where m.ticket_id=p_ticket and m.template=p_template and m.accepted=p_accepted);
end$$;
create function api.record_frontend_support_mail(p_ticket uuid,p_template text,p_accepted boolean)
returns boolean language sql security invoker set search_path=pg_catalog as $$select internal.record_frontend_support_mail(p_ticket,p_template,p_accepted)$$;

create function internal.get_frontend_support_inbox(p_page integer default 1,p_ticket uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('support:view');answer jsonb;can_update boolean;
begin
  if p_page is null or p_page not between 1 and 100000 then raise exception 'valid support page required' using errcode='22023';end if;
  can_update:=exists(select 1 from private.staff_roles s join private.staff_capabilities c on c.role=s.role and c.capability='support:update'
    where s.user_id=actor and s.revoked_at is null);
  with scope as (
    select * from private.support_tickets t where p_ticket is null or t.id=p_ticket
  ), rows as (
    select * from scope order by created_at desc,id desc limit 50 offset case when p_ticket is null then (p_page-1)*50 else 0 end
  )
  select jsonb_build_object('actor_id',actor,'total',(select count(*) from scope),'can_update',can_update,
    'new_count',(select count(*) from private.support_tickets where status='new'),
    'oldest_new_at',(select min(created_at) from private.support_tickets where status='new'),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'email',t.email,
      'message','['||t.category||'] '||t.message,'status',t.status,'revision',t.revision,'created_at',t.created_at,
      'emailActivity',coalesce((select jsonb_agg(jsonb_build_object('template',m.template,'accepted',m.accepted,'created_at',m.created_at)
        order by m.created_at,m.template) from private.support_ticket_mail m where m.ticket_id=t.id),'[]'::jsonb))
      order by t.created_at desc,t.id desc) from rows t),'[]'::jsonb)) into answer;
  perform internal.staff_actor('support:view');return answer;
end$$;
create function api.get_frontend_support_inbox(p_page integer default 1,p_ticket uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_support_inbox(p_page,p_ticket)$$;

create function internal.get_frontend_support_metrics()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('support:view');result jsonb;
begin
  select jsonb_build_object('actor_id',actor,'new',count(*),'oldest_at',min(created_at)) into result
    from private.support_tickets where status='new';
  perform internal.staff_actor('support:view');return result;
end$$;
create function api.get_frontend_support_metrics()
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_support_metrics()$$;

create function internal.update_frontend_support_status(p_ticket uuid,p_revision integer,p_status text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('support:update');x private.support_tickets;
begin
  if p_revision is null or p_revision not between 1 and 2147483646 or p_status is null or p_status not in('new','in_progress','resolved')
    then raise exception 'represented support status required' using errcode='22023';end if;
  select * into x from private.support_tickets where id=p_ticket for update;
  actor:=internal.staff_actor('support:update');
  if not found or x.revision<>p_revision then raise exception 'support ticket changed' using errcode='PT409';end if;
  if x.status<>p_status then
    update private.support_tickets set status=p_status,revision=revision+1 where id=x.id returning * into x;
    insert into private.support_ticket_events(ticket_id,revision,actor_id,status) values(x.id,x.revision,actor,x.status);
  end if;
  perform internal.staff_actor('support:update');
  return jsonb_build_object('id',x.id,'status',x.status,'revision',x.revision);
end$$;
create function api.update_frontend_support_status(p_ticket uuid,p_revision integer,p_status text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.update_frontend_support_status(p_ticket,p_revision,p_status)$$;

do $$declare signature text;ns text;audience text;begin
  foreach signature in array array['submit_frontend_support(text,text,text,text)','record_frontend_support_mail(uuid,text,boolean)','get_frontend_support_inbox(integer,uuid)','get_frontend_support_metrics()','update_frontend_support_status(uuid,integer,text)'] loop
    audience:=case when signature like 'submit_%' or signature like 'record_%' then 'service_role' else 'authenticated' end;
    foreach ns in array array['api','internal'] loop
      execute format('revoke all on function %I.%s from public,anon,authenticated,service_role',ns,signature);
      execute format('grant execute on function %I.%s to %I',ns,signature,audience);
    end loop;
  end loop;
end$$;
notify pgrst,'reload schema';
commit;
