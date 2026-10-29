begin;
-- Fixed, isolated synthetic identities sort before the random native fixtures.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values
 ('00000000-0000-4000-8000-000000000101','authenticated','authenticated','runtime-held@example.invalid',clock_timestamp(),'{}','{"display_name":"Synthetic Member"}',false,clock_timestamp(),clock_timestamp()),
 ('00000000-0000-4000-8000-000000000102','authenticated','authenticated','runtime-free@example.invalid',clock_timestamp(),'{}','{"display_name":"Synthetic Member"}',false,clock_timestamp(),clock_timestamp());
insert into private.evidence_cases(id,subject_id,kind) values
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','business'),
 ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','business');
insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state,sha256,size_bytes,created_at,retain_until)
select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','id_front','evidence/runtime-held-'||n,'clean',repeat('a',64),128,clock_timestamp()-interval '91 days',clock_timestamp()-interval '1 day'
from generate_series(301,304) n;
insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state,sha256,size_bytes,created_at,retain_until)
values('00000000-0000-4000-8000-000000000305','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','id_front','evidence/runtime-unheld','clean',repeat('b',64),128,clock_timestamp()-interval '91 days',null);
insert into private.legal_holds(subject_id,placed_by,reason) values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102','Synthetic regression hold');
do $$
declare claimed jsonb;
begin
  claimed:=internal.claim_evidence_cleanup(4);
  if not exists(select 1 from jsonb_array_elements(claimed) e where e->>'artifact_id'='00000000-0000-4000-8000-000000000305') then
    raise exception 'held prefix blocked unheld expired partial upload'; end if;
  if exists(select 1 from private.evidence_artifacts where owner_id='00000000-0000-4000-8000-000000000101' and state<>'clean') then
    raise exception 'held evidence was selected'; end if;
end;
$$;
select 'PASS runtime retention regressions';
rollback;
