-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.customer_invoice_numbers (
  invoice_year integer not null,
  last_number integer not null,
  constraint customer_invoice_numbers_gapless TRIGGER DEFERRABLE INITIALLY DEFERRED,
  constraint customer_invoice_numbers_invoice_year_check CHECK (invoice_year >= 2026 AND invoice_year <= 9999),
  constraint customer_invoice_numbers_last_number_check CHECK (last_number >= 1 AND last_number <= 999999),
  constraint customer_invoice_numbers_pkey PRIMARY KEY (invoice_year)
);
alter table private.customer_invoice_numbers owner to postgres;
alter table private.customer_invoice_numbers enable row level security;
CREATE CONSTRAINT TRIGGER customer_invoice_numbers_gapless AFTER INSERT OR UPDATE ON private.customer_invoice_numbers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION internal.customer_invoice_numbers_gapless();
CREATE TRIGGER customer_invoice_numbers_guard BEFORE INSERT OR DELETE OR UPDATE ON private.customer_invoice_numbers FOR EACH ROW EXECUTE FUNCTION internal.customer_invoice_number_guard();
revoke all on private.customer_invoice_numbers from public;
