-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.support_ticket_mail (
  ticket_id uuid not null,
  template text not null,
  accepted boolean not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  constraint support_ticket_mail_pkey PRIMARY KEY (ticket_id, template),
  constraint support_ticket_mail_template_check CHECK (template = ANY (ARRAY['support_acknowledgement'::text, 'support_staff_alert'::text])),
  constraint support_ticket_mail_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES private.support_tickets(id) ON DELETE CASCADE
);
alter table private.support_ticket_mail owner to postgres;
alter table private.support_ticket_mail enable row level security;
revoke all on private.support_ticket_mail from public;
