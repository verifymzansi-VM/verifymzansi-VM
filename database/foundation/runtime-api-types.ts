// Reviewed additive APIs for the already-provisioned database. The immutable
// clean-baseline generator artifacts remain in api-role-types.ts.
import type { Json } from "./api.types";
import type {
  FoundationAuthenticatedDatabase as Baseline,
  FoundationServiceDatabase,
} from "./api-role-types";
export type FoundationRuntimeAuthenticatedDatabase = {
  api: Omit<Baseline["api"], "Functions"> & {
    Functions: Baseline["api"]["Functions"] & {
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
