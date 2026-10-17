-- CLI-created BF-09 draft. Deliberately cannot deploy while acceptance is open.
-- candidate.sql is a separately reviewed assembly, not a migration to run here.
do $foundation_gate$
begin
  raise exception 'Unreleased foundation draft: G1 and BF-09 gates are incomplete';
end;
$foundation_gate$;
