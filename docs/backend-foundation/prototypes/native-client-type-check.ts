import { createClient } from "@supabase/supabase-js";
import type { Database } from "./native-api-types";

export function nativeFixtureClient(url: string, publishableKey: string) {
  return createClient<Database, "api">(url, publishableKey, {
    db: { schema: "api" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Compile-time assertions only; this function is never called by the harness.
export function assertNativeContractTypes(client: ReturnType<typeof nativeFixtureClient>) {
  client.rpc("rename_transport_resource", { p_id: "synthetic", p_revision: 1, p_title: "Title" });
  client.rpc("save_core_listing_terms", {
    p_id: "synthetic",
    p_expected_revision: 1,
    p_terms: { price: { mode: "on_request" }, negotiable: true },
  });
  client.rpc("withdraw_decision", {
    p_decision_id: "synthetic",
    p_expected_version: 1,
    p_reason: "Synthetic recovery",
  });
  client.rpc("renew_evidence_claim", {
    p_case_id: "synthetic",
    p_claim_generation: "9007199254740994",
    p_claim_nonce: "synthetic",
  });
  const evidence: Database["api"]["Functions"]["staff_evidence_metadata"]["Args"] = {
    p_case_id: "synthetic",
    p_claim_generation: "9007199254740994",
    p_claim_nonce: "synthetic",
    p_purpose: "Synthetic review",
  };
  client.rpc("staff_evidence_metadata", evidence);
  // @ts-expect-error metadata access requires the current generation and nonce
  const unfencedEvidence: Database["api"]["Functions"]["staff_evidence_metadata"]["Args"] = {
    p_case_id: "synthetic",
    p_purpose: "Synthetic review",
  };
  void unfencedEvidence;
  client.rpc("save_listing_attributes", {
    p_post_id: "synthetic",
    p_expected_revision: 1,
    p_attributes: { device_type: "Smartphone", brand: "Fixture" },
  });
  const cleanup: Database["api"]["Functions"]["mark_media_deleted"]["Args"] = {
    p_object_id: "synthetic",
    p_claim_token: "synthetic",
  };
  client.rpc("mark_media_deleted", cleanup);
  // @ts-expect-error cleanup acknowledgement must bind the current lease token
  const unboundCleanup: Database["api"]["Functions"]["mark_media_deleted"]["Args"] = {
    p_object_id: "synthetic",
  };
  void unboundCleanup;
  const command: Database["api"]["Functions"]["rename_transport_resource"]["Args"] = {
    p_id: "synthetic",
    p_revision: 1,
    p_title: "Title",
  };
  // Supabase's generic rpc() permits extra properties; the explicit command
  // type and the native PostgREST rejection test enforce the actor-free shape.
  // @ts-expect-error actor identity is not a field of the generated command type
  command.p_actor = "foreign";
  // @ts-expect-error no private schema is generated or accepted
  client.schema("private");
  // @ts-expect-error base tables are not an exposed client contract
  client.from("transport_resources");
}
