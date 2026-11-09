-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE TRIGGER claim_owner_admin_invitation AFTER INSERT OR UPDATE OF status ON auth.mfa_factors FOR EACH ROW EXECUTE FUNCTION internal.claim_owner_admin_invitation();
CREATE TRIGGER create_account_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION internal.create_account_profile();
