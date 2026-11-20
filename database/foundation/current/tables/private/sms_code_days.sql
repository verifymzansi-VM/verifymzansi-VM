-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.sms_code_days (
  day date not null,
  sent integer default 0 not null,
  constraint sms_code_days_pkey PRIMARY KEY (day),
  constraint sms_code_days_sent_check CHECK (sent >= 0)
);
alter table private.sms_code_days owner to postgres;
alter table private.sms_code_days enable row level security;
revoke all on private.sms_code_days from public;
