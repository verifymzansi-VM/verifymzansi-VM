-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.category_fields (
  category_key text not null,
  key text not null,
  label text not null,
  renderer text not null,
  option_authority text not null,
  required boolean not null,
  validation jsonb not null,
  options jsonb,
  unit text,
  depends_on text,
  depends_on_values jsonb,
  dynamic_maximum text,
  facet_kind text,
  sort_order integer not null,
  constraint category_fields_category_key_fkey FOREIGN KEY (category_key) REFERENCES private.categories(key),
  constraint category_fields_check CHECK (facet_kind IS NULL OR (renderer <> ALL (ARRAY['text'::text, 'combobox'::text]))),
  constraint category_fields_check1 CHECK (facet_kind IS DISTINCT FROM 'choice'::text OR renderer = 'select'::text AND option_authority = 'closed'::text),
  constraint category_fields_depends_on_values_check CHECK (depends_on_values IS NULL OR jsonb_typeof(depends_on_values) = 'array'::text),
  constraint category_fields_facet_kind_check CHECK (facet_kind = ANY (ARRAY['choice'::text, 'contains'::text, 'boolean'::text, 'range'::text])),
  constraint category_fields_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,79}$'::text),
  constraint category_fields_option_authority_check CHECK (option_authority = ANY (ARRAY['closed'::text, 'suggestions'::text, 'none'::text])),
  constraint category_fields_options_check CHECK (options IS NULL OR jsonb_typeof(options) = 'array'::text),
  constraint category_fields_pkey PRIMARY KEY (category_key, key),
  constraint category_fields_renderer_check CHECK (renderer = ANY (ARRAY['text'::text, 'number'::text, 'select'::text, 'boolean'::text, 'checklist'::text, 'money'::text, 'combobox'::text])),
  constraint category_fields_validation_check CHECK (jsonb_typeof(validation) = 'object'::text)
);
alter table private.category_fields owner to postgres;
alter table private.category_fields enable row level security;
revoke all on private.category_fields from public;
