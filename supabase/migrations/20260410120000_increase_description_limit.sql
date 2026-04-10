-- Increase listing description CHECK constraint from 2000 to 5000 characters
-- to match the Zod validation and support richer SA marketplace descriptions.
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_description_check;
ALTER TABLE listings ADD CONSTRAINT listings_description_check CHECK (char_length(description) <= 5000);
