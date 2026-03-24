-- Fix RLS policies on account_profiles table after hard rename from seller_profiles
-- Ensures explicit WITH CHECK clauses and proper policy definitions
-- Addresses: "Failed to update profile" error when saving phone number

-- Drop and recreate the UPDATE policy with explicit WITH CHECK clause
-- This was missing after the rename (20260311120000) which caused UPDATE operations to fail
DROP POLICY IF EXISTS "Owner or admin updates profile" ON public.account_profiles;

CREATE POLICY "Owner or admin updates profile" ON public.account_profiles FOR UPDATE
  USING ((select auth.uid()) = user_id OR (select public.has_role('admin')))
  WITH CHECK ((select auth.uid()) = user_id OR (select public.has_role('admin')));

-- Verify other policies are present and correct for account_profiles
DROP POLICY IF EXISTS "Owner reads own profile" ON public.account_profiles;

CREATE POLICY "Owner reads own profile" ON public.account_profiles FOR SELECT
  USING ((select auth.uid()) = user_id OR (select public.has_role('admin')));

DROP POLICY IF EXISTS "Owner creates profile" ON public.account_profiles;

CREATE POLICY "Owner creates profile" ON public.account_profiles FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admin deletes profile" ON public.account_profiles;

CREATE POLICY "Admin deletes profile" ON public.account_profiles FOR DELETE
  USING ((select public.has_role('admin')));
