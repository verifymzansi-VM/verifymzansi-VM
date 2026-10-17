export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  api: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      acknowledge_cost_alarm: { Args: { p_alarm_id: string }; Returns: Json };
      activate_post: { Args: { p_post_id: string }; Returns: Json };
      advance_evidence_artifact: {
        Args: { p_artifact_id: string; p_sha256?: string; p_size?: number; p_state: string };
        Returns: Json;
      };
      apply_provider_event: { Args: { p_event: Json }; Returns: Json };
      approve_decision: { Args: { p_decision_id: string }; Returns: Json };
      attach_provider_request: {
        Args: { p_payment_id: string; p_request_id: string };
        Returns: boolean;
      };
      begin_evidence_upload: { Args: { p_case_id: string; p_purpose: string }; Returns: Json };
      begin_media_upload: { Args: { p_bytes: number; p_kind: string }; Returns: Json };
      billing_catalogue: { Args: Record<PropertyKey, never>; Returns: Json };
      check_cost_alarms: { Args: Record<PropertyKey, never>; Returns: number };
      claim_evidence_case: { Args: { p_case_id: string }; Returns: Json };
      claim_evidence_cleanup: { Args: { p_limit: number }; Returns: Json };
      claim_media_cleanup: { Args: { p_limit: number }; Returns: Json };
      claim_queue_item: { Args: { p_id: string; p_subject: string }; Returns: Json };
      claim_queue_items: { Args: { p_limit: number; p_queue: string }; Returns: Json };
      claim_verification_phone_attempt: {
        Args: { p_challenge: string; p_owner: string };
        Returns: Json;
      };
      close_account_evidence: { Args: { p_user_id: string }; Returns: Json };
      confirm_verification_locality: {
        Args: { p_city: string; p_province: string };
        Returns: Json;
      };
      create_core_draft: {
        Args: { p_area: string; p_category_key: string; p_detail: Json; p_kind: string };
        Returns: Json;
      };
      create_post_edit: { Args: { p_expected_revision: number; p_post_id: string }; Returns: Json };
      create_verification_phone_challenge: {
        Args: { p_hash: string; p_owner: string; p_phone: string };
        Returns: Json;
      };
      delete_post: { Args: { p_expected_revision: number; p_post_id: string }; Returns: Json };
      discard_post_edit: {
        Args: { p_edit_id: string; p_expected_revision: number };
        Returns: Json;
      };
      finalize_media: {
        Args: {
          p_height?: number;
          p_mime: string;
          p_object_id: string;
          p_sha256: string;
          p_size: number;
          p_width?: number;
        };
        Returns: Json;
      };
      finalize_verification_phone: {
        Args: { p_challenge: string; p_expected_hash: string; p_owner: string };
        Returns: Json;
      };
      get_core_draft: { Args: { p_id: string }; Returns: Json };
      get_core_listing_draft: { Args: { p_id: string }; Returns: Json };
      get_listing_attributes: { Args: { p_post_id: string }; Returns: Json };
      get_owner_listing_editor: { Args: { p_post_id: string }; Returns: Json };
      get_public_post: { Args: { p_id: string }; Returns: Json };
      grant_verified_intro_trial: { Args: { p_days: number; p_owner: string }; Returns: Json };
      identity_status: { Args: { p_identity_hmac: string }; Returns: Json };
      mark_media_deleted: {
        Args: { p_claim_token: string; p_object_id: string };
        Returns: boolean;
      };
      moderate_post: {
        Args: {
          p_claim_generation: string;
          p_claim_nonce: string;
          p_decision: string;
          p_expected_revision: number;
          p_post_id: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      my_posting_capacity: { Args: Record<PropertyKey, never>; Returns: Json };
      my_queue_claims: { Args: Record<PropertyKey, never>; Returns: Json };
      open_verification_case: { Args: Record<PropertyKey, never>; Returns: Json };
      place_legal_hold: { Args: { p_reason: string; p_subject_id: string }; Returns: Json };
      propose_decision: {
        Args: { p_action: string; p_case_id: string; p_expected_version: number; p_payload: Json };
        Returns: Json;
      };
      propose_verified_identity_ban: {
        Args: { p_category: string; p_fact: string; p_owner: string; p_request: string };
        Returns: Json;
      };
      purge_expired_identity_bans: { Args: { p_limit: number }; Returns: number };
      purge_expired_trial_identities: { Args: { p_limit: number }; Returns: number };
      read_listing_price_draft: { Args: Record<PropertyKey, never>; Returns: Json };
      reassign_queue_claim: {
        Args: { p_id: string; p_reason: string; p_subject: string; p_to: string };
        Returns: Json;
      };
      reconcile_verified_identity_ban: { Args: { p_decision: string }; Returns: Json };
      reference_catalog: { Args: Record<PropertyKey, never>; Returns: Json };
      register_identity_submission: {
        Args: {
          p_case: string;
          p_encrypted_number: Json;
          p_expected_version: number;
          p_fingerprint: string;
          p_id_artifact: string;
          p_identity_key: string;
          p_receipt: string;
          p_risk_score: number;
          p_selfie_artifact: string;
        };
        Returns: Json;
      };
      release_post: { Args: { p_post_id: string; p_reason?: string }; Returns: boolean };
      release_queue_claim: {
        Args: {
          p_claim_generation: string;
          p_claim_nonce: string;
          p_id: string;
          p_subject: string;
        };
        Returns: Json;
      };
      renew_evidence_claim: {
        Args: { p_case_id: string; p_claim_generation: string; p_claim_nonce: string };
        Returns: Json;
      };
      renew_queue_claim: {
        Args: {
          p_claim_generation: string;
          p_claim_nonce: string;
          p_id: string;
          p_subject: string;
        };
        Returns: Json;
      };
      resolve_report: {
        Args: {
          p_claim_generation: string;
          p_claim_nonce: string;
          p_note: string;
          p_outcome: string;
          p_report_id: string;
        };
        Returns: Json;
      };
      reverse_payment: {
        Args: { p_kind: string; p_payment_id: string; p_reason: string };
        Returns: Json;
      };
      review_identity_submission: {
        Args: {
          p_claim_generation: string;
          p_claim_nonce: string;
          p_expected_version: number;
          p_number_matches: boolean;
          p_selfie_matches: boolean;
          p_submission: string;
        };
        Returns: Json;
      };
      run_post_lifecycle: { Args: { p_limit: number }; Returns: Json };
      save_core_listing_terms: {
        Args: { p_expected_revision: number; p_id: string; p_terms: Json };
        Returns: Json;
      };
      save_listing_attributes: {
        Args: { p_attributes: Json; p_expected_revision: number; p_post_id: string };
        Returns: Json;
      };
      save_listing_price_draft: {
        Args: { p_category_key: string; p_expected_revision: number; p_terms: Json };
        Returns: Json;
      };
      save_post_content: {
        Args: { p_content: Json; p_expected_revision: number; p_post_id: string };
        Returns: Json;
      };
      search_posts: { Args: { p_request: Json }; Returns: Json };
      set_post_media: {
        Args: { p_expected_revision: number; p_items: Json; p_post_id: string };
        Returns: Json;
      };
      set_post_state: {
        Args: { p_action: string; p_expected_revision: number; p_post_id: string };
        Returns: Json;
      };
      staff_cost_overview: { Args: Record<PropertyKey, never>; Returns: Json };
      staff_evidence_metadata: {
        Args: {
          p_case_id: string;
          p_claim_generation: string;
          p_claim_nonce: string;
          p_purpose: string;
        };
        Returns: Json;
      };
      staff_identity_history: {
        Args: { p_before_id?: string; p_before_time?: string; p_owner: string };
        Returns: Json;
      };
      staff_identity_review_context: {
        Args: { p_case: string; p_claim_generation: string; p_claim_nonce: string };
        Returns: Json;
      };
      staff_review_post: {
        Args: { p_claim_generation: string; p_claim_nonce: string; p_post_id: string };
        Returns: Json;
      };
      staff_review_report: {
        Args: { p_claim_generation: string; p_claim_nonce: string; p_report_id: string };
        Returns: Json;
      };
      start_checkout: { Args: { p_product_id: string; p_target_post?: string }; Returns: Json };
      submit_post: { Args: { p_expected_revision: number; p_post_id: string }; Returns: Json };
      submit_report: {
        Args: {
          p_category: string;
          p_description: string;
          p_post_id: string;
          p_reporter_id?: string;
          p_reporter_ip_hmac: string;
        };
        Returns: Json;
      };
      withdraw_decision: {
        Args: { p_decision_id: string; p_expected_version: number; p_reason: string };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  api: {
    Enums: {},
  },
} as const;
