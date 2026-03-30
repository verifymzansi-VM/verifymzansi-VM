-- Add layout_template column to businesses table.
-- Allows users to choose between 'cinematic', 'showcase', or 'professional' layout.
-- NULL means the category default mapping is used.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS layout_template TEXT DEFAULT NULL;

-- Soft constraint via CHECK (allows NULL plus the three values)
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_layout_template_check
  CHECK (layout_template IS NULL OR layout_template IN ('cinematic', 'showcase', 'professional'));

COMMENT ON COLUMN public.businesses.layout_template IS
  'Optional profile layout override. NULL = use category default. Values: cinematic, showcase, professional.';
