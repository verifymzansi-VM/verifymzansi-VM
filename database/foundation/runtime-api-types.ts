// Reviewed additive APIs for the already-provisioned database. The immutable
// clean-baseline generator artifacts remain in api-role-types.ts.
import type { Json } from "./api.types";
import type {
  FoundationAuthenticatedDatabase as Baseline,
  FoundationPublicDatabase,
  FoundationServiceDatabase,
} from "./api-role-types";
export type FoundationRuntimePublicDatabase = {
  api: Omit<FoundationPublicDatabase["api"], "Functions"> & {
    Functions: FoundationPublicDatabase["api"]["Functions"] & {
      get_public_frontend_business_seen: { Args: { p_post_ids: string[] }; Returns: Json };
      get_public_frontend_business_affiliations: { Args: { p_post_ids: string[] }; Returns: Json };
      get_public_frontend_business_cipc: { Args: { p_post_ids: string[] }; Returns: Json };
    };
  };
};
export type FoundationRuntimeAuthenticatedDatabase = {
  api: Omit<Baseline["api"], "Functions"> & {
    Functions: Baseline["api"]["Functions"] & {
      get_frontend_affiliation_workspace: { Args: { p_slug?: string }; Returns: Json };
      frontend_form_draft: {
        Args: {
          p_flow: string;
          p_action: string;
          p_step?: number;
          p_data?: Json;
          p_expected_account?: string;
        };
        Returns: Json;
      };
      get_public_frontend_business_affiliations: { Args: { p_post_ids: string[] }; Returns: Json };
      get_frontend_staff_organisation_directory: { Args: Record<never, never>; Returns: Json };
      get_frontend_staff_organisation_detail: { Args: { p_id: string }; Returns: Json };
      get_frontend_staff_payments: { Args: { p_page: number; p_status?: string }; Returns: Json };
      record_frontend_staff_payment_reversal: {
        Args: { p_id: string; p_kind: string; p_reason: string };
        Returns: Json;
      };
      start_slot_checkout: {
        Args: {
          p_plan_id: string;
          p_slots: number;
          p_expected_total_cents: number;
          p_cooling_off_consent: boolean;
        };
        Returns: Json;
      };
      get_my_slots: { Args: Record<never, never>; Returns: Json };
      record_staff_slot_reversal: {
        Args: { p_line_id: string; p_kind: string; p_reason: string };
        Returns: Json;
      };
      staff_set_individual_slot_limit: {
        Args: { p_account_id: string; p_slot_limit: number; p_ends_at: string; p_reason: string };
        Returns: Json;
      };
      get_staff_payment_list: { Args: { p_page: number; p_filter?: string }; Returns: Json };
      activate_staff_paid_payment: {
        Args: { p_payment_id: string; p_reason: string };
        Returns: Json;
      };
      record_staff_payment_refund: {
        Args: {
          p_payment_id: string;
          p_kind: string;
          p_reason_code: string;
          p_reason: string;
          p_ozow_reference: string;
        };
        Returns: Json;
      };
      record_staff_slot_refund: {
        Args: {
          p_line_id: string;
          p_kind: string;
          p_reason_code: string;
          p_reason: string;
          p_ozow_reference: string;
        };
        Returns: Json;
      };
      approve_staff_payment_refund: { Args: { p_request_id: string }; Returns: Json };
      decline_staff_payment_refund: {
        Args: { p_request_id: string; p_reason: string };
        Returns: Json;
      };
      save_frontend_organisation_profile: {
        Args: {
          p_slug: string;
          p_patch: Json;
          p_reason: string;
          p_id?: string;
          p_expected?: number;
        };
        Returns: Json;
      };
      get_frontend_organisation_dashboard: { Args: { p_slug: string }; Returns: Json };
      execute_frontend_organisation_action: {
        Args: {
          p_org: string;
          p_item: string;
          p_action: string;
          p_value?: string;
          p_note?: string;
        };
        Returns: Json;
      };
      get_my_frontend_business_review_state: { Args: { p_business: string }; Returns: Json };
      get_frontend_business_review_queue: { Args: { p_tab: string }; Returns: Json };
      get_frontend_cipc_case: { Args: { p_case: string }; Returns: Json };
      request_frontend_cipc_recheck: {
        Args: { p_business: string; p_source?: string };
        Returns: Json;
      };
      switch_frontend_cipc_representative: {
        Args: { p_business: string; p_case: string };
        Returns: Json;
      };
      set_frontend_cipc_office_visibility: {
        Args: { p_business: string; p_show: boolean };
        Returns: Json;
      };
      decide_frontend_cipc: {
        Args: {
          p_case: string;
          p_expected: string;
          p_action: string;
          p_generation: string;
          p_nonce: string;
          p_note?: string;
          p_reason?: string;
          p_confirmed?: boolean;
        };
        Returns: Json;
      };
      revoke_frontend_cipc: {
        Args: { p_case: string; p_expected: string; p_note: string; p_reason: string };
        Returns: Json;
      };
      correct_frontend_cipc_office: {
        Args: {
          p_case: string;
          p_expected: string;
          p_generation: string;
          p_nonce: string;
          p_office: Json;
        };
        Returns: Json;
      };
      record_frontend_cipc_callback: {
        Args: {
          p_case: string;
          p_expected: string;
          p_generation: string;
          p_nonce: string;
          p_domain: boolean;
          p_callback: Json;
        };
        Returns: Json;
      };
      reserve_frontend_cipc_document: {
        Args: {
          p_business: string;
          p_number: string;
          p_route: string;
          p_office: boolean;
          p_digest: string;
          p_case?: string;
        };
        Returns: Json;
      };
      reserve_frontend_cipc_official: {
        Args: {
          p_case: string;
          p_expected: string;
          p_generation: string;
          p_nonce: string;
          p_digest: string;
        };
        Returns: Json;
      };
      get_my_frontend_business_checks: { Args: { p_business: string }; Returns: Json };
      get_public_frontend_business_seen: { Args: { p_post_ids: string[] }; Returns: Json };
      get_public_frontend_business_cipc: { Args: { p_post_ids: string[] }; Returns: Json };
      request_frontend_business_seen: {
        Args: {
          p_business: string;
          p_method: string;
          p_slots: string[];
          p_consent: boolean;
          p_address?: string;
        };
        Returns: Json;
      };
      withdraw_frontend_business_check: {
        Args: { p_business: string; p_case: string };
        Returns: Json;
      };
      get_frontend_seen_queue: { Args: { p_tab: string }; Returns: Json };
      get_frontend_seen_case: { Args: { p_case: string }; Returns: Json };
      reserve_frontend_seen_photo: {
        Args: { p_case: string; p_digest: string; p_lat?: number; p_lng?: number; p_mime?: string };
        Returns: Json;
      };
      get_frontend_seen_photo_receipt: {
        Args: { p_case: string; p_artifact: string };
        Returns: Json;
      };
      schedule_frontend_seen_check: {
        Args: {
          p_case: string;
          p_expected: string;
          p_scheduled: string;
          p_generation?: string;
          p_nonce?: string;
        };
        Returns: Json;
      };
      report_frontend_seen_check: {
        Args: { p_case: string; p_expected: string; p_report: Json };
        Returns: Json;
      };
      decide_frontend_seen_check: {
        Args: {
          p_case: string;
          p_expected: string;
          p_action: string;
          p_generation: string;
          p_nonce: string;
          p_note?: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      revoke_frontend_seen_check: {
        Args: { p_case: string; p_expected: string; p_note: string; p_reason: string };
        Returns: Json;
      };
      send_frontend_seen_message: {
        Args: { p_case: string; p_body: string; p_business?: string; p_artifact?: string };
        Returns: Json;
      };
      reserve_frontend_seen_reply_file: {
        Args: { p_business: string; p_case: string; p_digest: string; p_mime: string };
        Returns: Json;
      };
      authorize_frontend_seen_file: {
        Args: { p_artifact: string; p_record?: boolean };
        Returns: Json;
      };
      get_frontend_staff_role_review: { Args: { p_page?: number; p_role?: string }; Returns: Json };
      propose_frontend_staff_role: {
        Args: { p_email: string; p_role: string; p_reason: string };
        Returns: Json;
      };
      review_frontend_staff_role: {
        Args: { p_decision: string; p_action: string; p_version?: number; p_note?: string };
        Returns: Json;
      };
      get_frontend_partner_admin: { Args: Record<PropertyKey, never>; Returns: Json };
      save_frontend_partner: {
        Args: {
          p_account: string;
          p_action: string;
          p_reason: string;
          p_code?: string;
          p_rate?: number;
          p_note?: string;
        };
        Returns: Json;
      };
      get_frontend_support_inbox: { Args: { p_page?: number; p_ticket?: string }; Returns: Json };
      get_frontend_support_metrics: { Args: Record<PropertyKey, never>; Returns: Json };
      update_frontend_support_status: {
        Args: { p_ticket: string; p_revision: number; p_status: string };
        Returns: Json;
      };
      export_frontend_privacy_request: {
        Args: { p_case: string; p_revision: number };
        Returns: Json;
      };
      record_frontend_privacy_intake: {
        Args: {
          p_type: string;
          p_email: string;
          p_phone: string | null;
          p_description: string;
          p_note: string;
          p_received?: string;
        };
        Returns: Json;
      };
      get_frontend_privacy_queue: {
        Args: { p_view?: string; p_page?: number };
        Returns: Json;
      };
      process_frontend_privacy_request: {
        Args: {
          p_case: string;
          p_revision: number;
          p_action: string;
          p_note?: string;
          p_assignee?: string;
          p_attestation?: string;
        };
        Returns: Json;
      };
      get_my_frontend_decisions: { Args: Record<PropertyKey, never>; Returns: Json };
      submit_my_frontend_appeal: {
        Args: { p_action: string; p_reason: string };
        Returns: Json;
      };
      get_frontend_appeal_queue: { Args: { p_appeal?: string }; Returns: Json };
      resolve_frontend_appeal: {
        Args: {
          p_appeal: string;
          p_outcome: string;
          p_reason: string;
          p_effect_version?: number;
          p_shorten_to?: string;
        };
        Returns: Json;
      };
      get_frontend_enforcement: { Args: Record<PropertyKey, never>; Returns: Json };
      get_my_frontend_restriction_status: { Args: Record<PropertyKey, never>; Returns: Json };
      get_frontend_report_review_queue: { Args: { p_area?: string }; Returns: Json };
      execute_frontend_report_action_v2: {
        Args: {
          p_report: string;
          p_expected_revision: number;
          p_claim_generation: string;
          p_claim_nonce: string;
          p_action: string;
          p_reason: string;
          p_duration_days?: number;
          p_emergency?: boolean;
          p_expected_post_revision?: number;
        };
        Returns: Json;
      };
      release_frontend_content_hold: {
        Args: { p_hold: string; p_expected_version: number; p_reason: string };
        Returns: Json;
      };
      lift_frontend_account_restriction: {
        Args: { p_restriction: string; p_expected_version: number; p_reason: string };
        Returns: Json;
      };
      list_my_frontend_notices: {
        Args: { p_limit?: number; p_unread?: boolean; p_before?: string };
        Returns: Json;
      };
      execute_frontend_report_action: {
        Args: {
          p_report: string;
          p_expected_revision: number;
          p_claim_generation: string;
          p_claim_nonce: string;
          p_action: string;
          p_reason: string;
          p_duration_days?: number;
          p_emergency?: boolean;
        };
        Returns: Json;
      };
      get_frontend_report_queue: { Args: { p_area?: string }; Returns: Json };
      get_frontend_area_activity: { Args: { p_area?: string; p_limit?: number }; Returns: Json };
      get_frontend_staff_audit_page: { Args: { p_request?: Json }; Returns: Json };
      get_frontend_feature_flags: { Args: Record<PropertyKey, never>; Returns: Json };
      get_frontend_governance_metrics: { Args: Record<PropertyKey, never>; Returns: Json };
      set_frontend_feature_flag: {
        Args: {
          p_key: string;
          p_expected_revision: number;
          p_mode: string;
          p_percent: number;
          p_roles: string[];
          p_reason: string;
        };
        Returns: Json;
      };
      get_frontend_governance_page: { Args: { p_request?: Json }; Returns: Json };
      decide_frontend_governance: {
        Args: {
          p_decision: string;
          p_case: string;
          p_expected_version: number;
          p_proposal_version: number;
          p_action: string;
          p_reason: string;
        };
        Returns: Json;
      };
      get_my_dashboard: { Args: Record<PropertyKey, never>; Returns: Json };
      get_my_frontend_identity_state: { Args: Record<PropertyKey, never>; Returns: Json };
      return_frontend_identity_step: {
        Args: {
          p_case: string;
          p_submission: string;
          p_artifact: string;
          p_expected_version: number;
          p_claim_generation: string;
          p_claim_nonce: string;
          p_decision: string;
          p_reason: string;
        };
        Returns: Json;
      };
      get_frontend_staff_verification_queue: {
        Args: { p_limit?: number; p_include_ids?: string[] };
        Returns: Json;
      };
      get_frontend_staff_identity_context: {
        Args: { p_owner?: string; p_artifact?: string };
        Returns: Json;
      };
      get_frontend_staff_selfie_capture: {
        Args: { p_case_id: string; p_claim_generation: string; p_claim_nonce: string };
        Returns: Json;
      };
      record_my_selfie_capture: {
        Args: { p_request: string; p_capture_method: string; p_browser_liveness_passed: boolean };
        Returns: Json;
      };
      approve_frontend_identity_step: {
        Args: {
          p_case: string;
          p_submission: string;
          p_artifact: string;
          p_expected_version: number;
          p_claim_generation: string;
          p_claim_nonce: string;
          p_matches: boolean;
          p_note?: string;
          p_override_reason?: string;
        };
        Returns: Json;
      };
      get_frontend_staff_claims: { Args: { p_items?: Json }; Returns: Json };
      control_my_frontend_staff_claims: { Args: { p_action: string }; Returns: Json };
      claim_frontend_staff_items: { Args: { p_queue: string; p_limit: number }; Returns: Json };
      reassign_frontend_staff_claim: {
        Args: { p_type: string; p_id: string; p_to: string | null; p_reason: string };
        Returns: Json;
      };
      get_frontend_staff_moderation_queue: {
        Args: { p_area?: string; p_limit?: number };
        Returns: Json;
      };
      get_my_frontend_posting_allowance: { Args: { p_area: string }; Returns: Json };
      get_my_frontend_posting_allowance_v2: { Args: { p_area: string }; Returns: Json };
      execute_my_frontend_post_action: {
        Args: {
          p_request: string;
          p_post: string;
          p_expected_revision: number;
          p_action: string;
          p_kind: string;
          p_area: string;
        };
        Returns: Json;
      };
      resolve_my_frontend_media: { Args: { p_keys?: string[]; p_ids?: string[] }; Returns: Json };
      reserve_frontend_media_upload: {
        Args: { p_kind: string; p_bytes: number; p_digest: string };
        Returns: Json;
      };
      get_my_frontend_post_manager: { Args: Record<PropertyKey, never>; Returns: Json };
      get_my_frontend_post: { Args: { p_id: string }; Returns: Json };
      list_my_frontend_posts: {
        Args: { p_kind: string; p_area?: string; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      get_my_frontend_post_v2: { Args: { p_id: string }; Returns: Json };
      list_my_frontend_posts_v2: {
        Args: { p_kind: string; p_area?: string; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      get_my_intro_trial: { Args: Record<PropertyKey, never>; Returns: Json };
      consume_frontend_post_command: { Args: { p_request: string }; Returns: Json };
      reserve_frontend_verification_upload: {
        Args: {
          p_request: string;
          p_purpose: string;
          p_digest: string;
          p_first_name?: string;
          p_last_name?: string;
        };
        Returns: Json;
      };
      get_my_frontend_verification_uploads: { Args: Record<PropertyKey, never>; Returns: Json };
      list_my_frontend_notifications: {
        Args: { p_limit?: number; p_unread?: boolean; p_before?: string };
        Returns: Json;
      };
      dismiss_my_notifications: { Args: { p_ids?: string[] }; Returns: Json };
      list_my_frontend_enquiries: {
        Args: {
          p_limit?: number;
          p_status?: "new" | "read" | "contacted" | "closed";
          p_before_created?: string;
          p_before_id?: string;
        };
        Returns: Json;
      };
      save_my_frontend_profile: {
        Args: {
          p_expected_revision: number;
          p_display_name?: string;
          p_bio?: string;
          p_province?: string;
          p_city?: string;
        };
        Returns: Json;
      };
    };
  };
};
export type FoundationRuntimeServiceDatabase = {
  api: Omit<FoundationServiceDatabase["api"], "Functions"> & {
    Functions: FoundationServiceDatabase["api"]["Functions"] & {
      purge_frontend_form_drafts: { Args: { p_limit: number }; Returns: number };
      expire_stale_checkouts: { Args: { p_limit: number }; Returns: number };
      record_payment_problem: {
        Args: {
          p_payment_id: string | null;
          p_reason: string;
          p_source: string;
          p_alert: boolean;
          p_transaction: string | null;
        };
        Returns: Json;
      };
      claim_payment_alerts: { Args: { p_limit: number }; Returns: Json };
      complete_payment_alerts: { Args: { p_claim: string; p_sent: boolean }; Returns: number };
      claim_payment_digest: { Args: { p_from_hour: number; p_limit: number }; Returns: Json };
      complete_payment_digest: { Args: { p_claim: string }; Returns: boolean };
      get_payment_receipt: { Args: { p_payment_id: string }; Returns: Json };
      start_frontend_cipc_email: {
        Args: {
          p_owner: string;
          p_session: string;
          p_business: string;
          p_case: string;
          p_email: string;
          p_position: string;
          p_digest: string;
        };
        Returns: Json;
      };
      mark_frontend_cipc_email_sent: {
        Args: { p_owner: string; p_session: string; p_case: string; p_challenge: string };
        Returns: boolean;
      };
      verify_frontend_cipc_email: {
        Args: {
          p_owner: string;
          p_session: string;
          p_business: string;
          p_case: string;
          p_digest: string;
        };
        Returns: Json;
      };
      record_frontend_cipc_parse: {
        Args: {
          p_actor: string;
          p_session: string;
          p_artifact: string;
          p_summary: Json;
          p_directors: Json;
        };
        Returns: Json;
      };
      get_frontend_cipc_preview_context: {
        Args: { p_owner: string; p_session: string; p_business: string; p_fingerprints: string[] };
        Returns: Json;
      };
      frontend_seen_file_object: { Args: { p_case: string; p_artifact: string }; Returns: Json };
      submit_frontend_support: {
        Args: { p_name: string; p_email: string; p_category: string; p_message: string };
        Returns: Json;
      };
      record_frontend_support_mail: {
        Args: { p_ticket: string; p_template: string; p_accepted: boolean };
        Returns: boolean;
      };
      claim_frontend_privacy_notice: { Args: Record<PropertyKey, never>; Returns: Json };
      complete_frontend_privacy_notice: {
        Args: { p_job: string; p_claim: string; p_delivered: boolean };
        Returns: boolean;
      };
      record_frontend_privacy_request: {
        Args: {
          p_account: string;
          p_session: string;
          p_type: string;
          p_name: string;
          p_last_four: string | null;
          p_details: string | null;
        };
        Returns: Json;
      };
      claim_supported_notification_outbox: {
        Args: { p_supported_kinds: string[]; p_limit?: number };
        Returns: Json;
      };
      submit_frontend_report: {
        Args: {
          p_post_id: string;
          p_kind: string;
          p_reason: string;
          p_description: string;
          p_reporter_ip_hmac: string;
          p_reporter_id?: string;
        };
        Returns: Json;
      };
      read_frontend_feature_config: { Args: Record<PropertyKey, never>; Returns: Json };
      complete_frontend_media_upload: {
        Args: {
          p_object_id: string;
          p_size: number;
          p_sha256: string;
          p_mime: string;
          p_width?: number;
          p_height?: number;
        };
        Returns: Json;
      };
      stage_frontend_post_command: {
        Args: { p_owner: string; p_request: string; p_digest: string; p_payload: Json };
        Returns: boolean;
      };
      frontend_verification_upload_context: {
        Args: { p_owner: string; p_request: string };
        Returns: Json;
      };
      complete_frontend_verification_upload: {
        Args: {
          p_owner: string;
          p_request: string;
          p_stored_sha256: string;
          p_content_sha256: string;
          p_size: number;
          p_identity?: Json;
          p_risk_score?: number;
        };
        Returns: Json;
      };
    };
  };
};
