// Generated from fresh clean-baseline EXECUTE grants. Body authorization is still required.
import type { Database } from "./api.types";
type Api = Database["api"];
export type FoundationPublicDatabase = {
  api: Omit<Api, "Functions"> & {
    Functions: Pick<
      Api["Functions"],
      "billing_catalogue" | "get_public_post" | "reference_catalog" | "search_posts"
    >;
  };
};
export type FoundationAuthenticatedDatabase = {
  api: Omit<Api, "Functions"> & {
    Functions: Pick<
      Api["Functions"],
      | "acknowledge_cost_alarm"
      | "activate_post"
      | "approve_decision"
      | "begin_evidence_upload"
      | "begin_media_upload"
      | "billing_catalogue"
      | "claim_evidence_case"
      | "claim_queue_item"
      | "claim_queue_items"
      | "confirm_verification_locality"
      | "create_core_draft"
      | "create_post_edit"
      | "delete_post"
      | "discard_post_edit"
      | "get_core_draft"
      | "get_core_listing_draft"
      | "get_listing_attributes"
      | "get_owner_business_event_editor"
      | "get_owner_listing_editor"
      | "get_public_post"
      | "moderate_post"
      | "my_posting_capacity"
      | "my_queue_claims"
      | "open_verification_case"
      | "place_legal_hold"
      | "propose_decision"
      | "propose_verified_identity_ban"
      | "read_listing_price_draft"
      | "reassign_queue_claim"
      | "reference_catalog"
      | "release_post"
      | "release_queue_claim"
      | "renew_evidence_claim"
      | "renew_queue_claim"
      | "resolve_report"
      | "review_identity_submission"
      | "save_core_listing_terms"
      | "save_listing_attributes"
      | "save_listing_price_draft"
      | "save_post_content"
      | "search_posts"
      | "set_post_media"
      | "set_post_state"
      | "staff_cost_overview"
      | "staff_evidence_metadata"
      | "staff_identity_history"
      | "staff_identity_review_context"
      | "staff_review_post"
      | "staff_review_report"
      | "start_checkout"
      | "submit_post"
      | "withdraw_decision"
    >;
  };
};
export type FoundationServiceDatabase = {
  api: Omit<Api, "Functions"> & {
    Functions: Pick<
      Api["Functions"],
      | "advance_evidence_artifact"
      | "apply_provider_event"
      | "attach_provider_request"
      | "check_cost_alarms"
      | "claim_evidence_cleanup"
      | "claim_media_cleanup"
      | "claim_verification_phone_attempt"
      | "close_account_evidence"
      | "create_verification_phone_challenge"
      | "finalize_media"
      | "finalize_verification_phone"
      | "grant_verified_intro_trial"
      | "identity_status"
      | "mark_media_deleted"
      | "purge_expired_identity_bans"
      | "purge_expired_trial_identities"
      | "reconcile_verified_identity_ban"
      | "register_identity_submission"
      | "reverse_payment"
      | "run_post_lifecycle"
      | "submit_report"
    >;
  };
};
