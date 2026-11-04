-- The owner's full administrator role includes routine staff work as well as
-- governance. Authority remains in the canonical matrix, with the same recent
-- MFA, case-claim, self-review and independent-approval checks in each command.
begin;
insert into private.staff_capabilities(role,capability,requires_recent_mfa) values
  ('admin','case:claim',false),
  ('admin','queue:claim',false),
  ('admin','evidence:view',true),
  ('admin','verification:decide_routine',true),
  ('admin','post:moderate',true),
  ('admin','report:resolve',true)
on conflict(role,capability) do update
  set requires_recent_mfa=private.staff_capabilities.requires_recent_mfa or excluded.requires_recent_mfa;
commit;
