-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.communication_choices_dto(p_account uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'marketing_email', coalesce(bool_or(l.granted) filter (where l.purpose = 'marketing_email'), false),
    'marketing_sms', coalesce(bool_or(l.granted) filter (where l.purpose = 'marketing_sms'), false),
    'analytics', coalesce(bool_or(l.granted) filter (where l.purpose = 'analytics'), false),
    'third_party_sharing', coalesce(bool_or(l.granted) filter (where l.purpose = 'third_party_sharing'), false))
  from (select distinct on (e.purpose) e.purpose, e.granted
    from private.communication_choice_events e
    where e.account_id = p_account
    order by e.purpose, e.recorded_at desc, e.id desc) l;
$function$;
alter function internal.communication_choices_dto(uuid) owner to postgres;
revoke all on function internal.communication_choices_dto(uuid) from public;
