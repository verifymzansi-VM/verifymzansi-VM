import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FoundationPublicDatabase,
  FoundationAuthenticatedDatabase,
  FoundationServiceDatabase,
} from "../database/foundation/api-role-types";
import type { FoundationPublicApi } from "../src/lib/foundation/public-api";

// Compile-only rejection checks are verified by the maintained type gate.
// Generated rpc argument typing does not reject all structurally excess JSON
// properties; strict runtime builders remain a separate mandatory boundary.
export function checkFoundationRoleTypes(
  publicApi: FoundationPublicApi,
  member: SupabaseClient<FoundationAuthenticatedDatabase, "api">,
  service: SupabaseClient<FoundationServiceDatabase, "api">,
  fullPublic: SupabaseClient<FoundationPublicDatabase, "api">
) {
  void publicApi.rpc("billing_catalogue");
  void member.rpc("open_verification_case");
  const core = { p_kind: "listing", p_area: "market", p_category_key: "electronics", p_detail: {} };
  void member.rpc("create_core_draft", core);
  void member.rpc("create_core_draft", { ...core, p_activity_key: "guided_tour" });
  // The generated optional text argument uses omission; the builder normalizes null.
  // @ts-expect-error supplied activity keys must be text
  void member.rpc("create_core_draft", { ...core, p_activity_key: 123 });
  // @ts-expect-error anonymous callers cannot create drafts
  void publicApi.rpc("create_core_draft", core);
  // @ts-expect-error service credentials do not grant owner creation
  void service.rpc("create_core_draft", core);
  void member.rpc("get_owner_listing_editor", { p_post_id: "opaque-post" });
  void member.rpc("get_owner_business_event_editor", { p_post_id: "opaque-post" });
  const context = {
    p_post_id: "opaque-post",
    p_expected_revision: 1,
    p_patch: { activity_key: null },
  };
  void member.rpc("save_business_event_context", context);
  // @ts-expect-error anonymous callers cannot mutate owner context
  void publicApi.rpc("save_business_event_context", context);
  // @ts-expect-error service credentials do not grant owner context writes
  void service.rpc("save_business_event_context", context);
  // @ts-expect-error the revision argument must be numeric
  void member.rpc("save_business_event_context", { ...context, p_expected_revision: "1" });

  // @ts-expect-error business/event metadata requires an authenticated owner
  void publicApi.rpc("get_owner_business_event_editor", { p_post_id: "opaque-post" });
  // @ts-expect-error service credentials do not grant owner metadata inspection
  void service.rpc("get_owner_business_event_editor", { p_post_id: "opaque-post" });
  // @ts-expect-error owner metadata reads require a UUID string argument
  void member.rpc("get_owner_business_event_editor", { p_post_id: 123 });
  // @ts-expect-error owner editor reads require an authenticated user
  void publicApi.rpc("get_owner_listing_editor", { p_post_id: "opaque-post" });
  // @ts-expect-error service credentials do not grant owner inspection commands
  void service.rpc("get_owner_listing_editor", { p_post_id: "opaque-post" });
  // @ts-expect-error the owner read requires a UUID string argument
  void member.rpc("get_owner_listing_editor", { p_post_id: 123 });
  void service.rpc("grant_verified_intro_trial", { p_owner: "opaque-subject", p_days: 7 });
  // @ts-expect-error service processing is not a public RPC
  void publicApi.rpc("register_identity_submission", {});
  // @ts-expect-error raw fingerprint grant is absent from the clean candidate
  void service.rpc("grant_intro_trial", {});
  // @ts-expect-error a service credential does not grant staff-user commands
  void service.rpc("approve_decision", { p_decision_id: "opaque-decision" });
  // @ts-expect-error members cannot call trusted server-only processing
  void member.rpc("register_identity_submission", {});
  // @ts-expect-error no public base tables exist
  void fullPublic.from("profiles");
  // @ts-expect-error the public adapter exposes only RPCs
  void publicApi.schema("private");
  // @ts-expect-error the typed clean client has no private schema
  void fullPublic.schema("private");
}
