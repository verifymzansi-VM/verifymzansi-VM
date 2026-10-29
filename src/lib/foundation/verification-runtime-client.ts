import type { SupabaseClient } from "@supabase/supabase-js";
import { foundationVerificationStatusSchema } from "./verification-status";

/** Browser self-read, through the explicit API schema; never a base-table read. */
export async function readFoundationVerificationStatus(api: Pick<SupabaseClient, "rpc">) {
  const { data, error } = await api.rpc("get_my_verification_case", {});
  if (error) throw new Error("Verification status unavailable");
  return foundationVerificationStatusSchema.parse(data);
}
