-- Migration: Auto-create seller_profiles row when a new user signs up
-- This trigger fires after INSERT on auth.users and creates a matching
-- seller_profiles row with defaults so the dashboard / middleware don't
-- encounter a null profile.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.seller_profiles (
    user_id,
    display_name,
    seller_verification_status,
    account_status
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'New Seller'),
    'incomplete',
    'active'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users insert
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
