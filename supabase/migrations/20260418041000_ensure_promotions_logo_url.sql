-- Reconcile environments where 20260411000000 was recorded but logo_url is still missing.
-- Safe no-op where the column already exists.
alter table public.promotions
add column if not exists logo_url text;
