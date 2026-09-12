-- Commit the enum value before the following migration uses it in an index.
ALTER TYPE public.content_edit_status ADD VALUE IF NOT EXISTS 'processing';
