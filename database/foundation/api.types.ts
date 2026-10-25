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
      accept_organisation_invite: { Args: { p_token_hash: string }; Returns: Json };
      accept_posting_terms: { Args: { p_document_hash: string; p_version: string }; Returns: Json };
      acknowledge_cost_alarm: { Args: { p_alarm_id: string }; Returns: Json };
      activate_post: { Args: { p_post_id: string }; Returns: Json };
      add_organisation_note: { Args: { p_note: string; p_org: string }; Returns: Json };
      advance_evidence_artifact: {
        Args: { p_artifact_id: string; p_sha256?: string; p_size?: number; p_state: string };
        Returns: Json;
      };
      apply_provider_event: { Args: { p_event: Json }; Returns: Json };
      apply_to_organisation: {
        Args: {
          p_consent: boolean;
          p_member_reference?: string;
          p_org: string;
          p_post_id: string;
          p_programme?: string;
          p_reason?: string;
          p_share_representative_name: boolean;
        };
        Returns: Json;
      };
      approve_decision: { Args: { p_decision_id: string }; Returns: Json };
      approve_due_commissions: { Args: { p_limit: number }; Returns: number };
      assess_identity_upload: {
        Args: {
          p_document_sha256: string;
          p_fingerprint: string;
          p_owner: string;
          p_selfie_sha256: string;
        };
        Returns: Json;
      };
      attach_provider_request: {
        Args: { p_payment_id: string; p_request_id: string };
        Returns: boolean;
      };
      begin_evidence_upload: { Args: { p_case_id: string; p_purpose: string }; Returns: Json };
      begin_media_upload: { Args: { p_bytes: number; p_kind: string }; Returns: Json };
      billing_catalogue: { Args: Record<PropertyKey, never>; Returns: Json };
      check_cost_alarms: { Args: Record<PropertyKey, never>; Returns: number };
      claim_checkout_request: { Args: { p_owner_id: string; p_payment_id: string }; Returns: Json };
      claim_evidence_case: { Args: { p_case_id: string }; Returns: Json };
      claim_evidence_cleanup: { Args: { p_limit: number }; Returns: Json };
      claim_media_cleanup: { Args: { p_limit: number }; Returns: Json };
      claim_notification_outbox: { Args: { p_limit?: number }; Returns: Json };
      claim_payment_reconciliation: { Args: { p_payment_id: string }; Returns: Json };
      claim_queue_item: { Args: { p_id: string; p_subject: string }; Returns: Json };
      claim_queue_items: { Args: { p_limit: number; p_queue: string }; Returns: Json };
      claim_verification_phone_attempt: {
        Args: { p_challenge: string; p_owner: string };
        Returns: Json;
      };
      close_account_evidence: { Args: { p_user_id: string }; Returns: Json };
      close_evidence_fraud_hold: {
        Args: { p_case_id: string; p_hold_id: string; p_reason: string };
        Returns: Json;
      };
      complete_checkout_request: {
        Args: {
          p_checkout_url: string;
          p_claim_token: string;
          p_owner_id: string;
          p_payment_id: string;
          p_request_id: string;
        };
        Returns: boolean;
      };
      complete_evidence_upload: {
        Args: {
          p_artifact: string;
          p_content_sha256: string;
          p_size: number;
          p_stored_sha256: string;
        };
        Returns: Json;
      };
      complete_notification_outbox: {
        Args: { p_claim: string; p_error?: string; p_id: string; p_ok: boolean };
        Returns: boolean;
      };
      confirm_verification_locality: {
        Args: { p_city: string; p_province: string };
        Returns: Json;
      };
      create_core_draft: {
        Args: {
          p_activity_key?: string;
          p_area: string;
          p_category_key: string;
          p_detail: Json;
          p_kind: string;
        };
        Returns: Json;
      };
      create_organisation: {
        Args: { p_name: string; p_reason: string; p_slug: string; p_type: string };
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
      end_sponsorship: { Args: { p_reason: string; p_sponsorship: string }; Returns: Json };
      evidence_review_object: { Args: { p_artifact: string; p_case: string }; Returns: Json };
      evidence_upload_target: { Args: { p_artifact: string; p_owner: string }; Returns: Json };
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
      finish_unpaid_checkout: {
        Args: { p_payment_id: string; p_status: string };
        Returns: boolean;
      };
      flag_duplicate_events: {
        Args: {
          p_expected_revision_a: number;
          p_expected_revision_b: number;
          p_post_a: string;
          p_post_b: string;
          p_reason: string;
        };
        Returns: Json;
      };
      get_checkout_payment: {
        Args: { p_merchant_reference?: string; p_payment_id?: string };
        Returns: Json;
      };
      get_core_draft: { Args: { p_id: string }; Returns: Json };
      get_core_listing_draft: { Args: { p_id: string }; Returns: Json };
      get_current_posting_terms: { Args: Record<PropertyKey, never>; Returns: Json };
      get_listing_attributes: { Args: { p_post_id: string }; Returns: Json };
      get_my_account_context: { Args: Record<PropertyKey, never>; Returns: Json };
      get_my_billing: { Args: Record<PropertyKey, never>; Returns: Json };
      get_my_inbox_counts: { Args: Record<PropertyKey, never>; Returns: Json };
      get_my_payment: { Args: { p_payment_id: string }; Returns: Json };
      get_my_profile: { Args: Record<PropertyKey, never>; Returns: Json };
      get_my_verification_case: { Args: Record<PropertyKey, never>; Returns: Json };
      get_owner_business_event_editor: { Args: { p_post_id: string }; Returns: Json };
      get_owner_listing_editor: { Args: { p_post_id: string }; Returns: Json };
      get_owner_post_contacts: { Args: { p_post_id: string }; Returns: Json };
      get_owner_posting_terms: { Args: Record<PropertyKey, never>; Returns: Json };
      get_owner_verification_readiness: { Args: Record<PropertyKey, never>; Returns: Json };
      get_public_contact_channels: { Args: { p_post_id: string }; Returns: Json };
      get_public_organisation: { Args: { p_slug: string }; Returns: Json };
      get_public_post: { Args: { p_id: string }; Returns: Json };
      get_staff_dashboard: { Args: Record<PropertyKey, never>; Returns: Json };
      grant_verified_intro_trial: { Args: { p_days: number; p_owner: string }; Returns: Json };
      identity_status: { Args: { p_identity_hmac: string }; Returns: Json };
      invite_organisation_admin: {
        Args: { p_email: string; p_org: string; p_reason: string; p_token_hash: string };
        Returns: Json;
      };
      list_my_enquiries: {
        Args: {
          p_before_created?: string;
          p_before_id?: string;
          p_limit?: number;
          p_status?: string;
        };
        Returns: Json;
      };
      list_my_notifications: {
        Args: { p_before_created?: string; p_before_id?: string; p_limit?: number };
        Returns: Json;
      };
      list_my_posts: { Args: { p_limit?: number; p_offset?: number }; Returns: Json };
      list_reconcilable_payments: { Args: { p_limit?: number }; Returns: Json };
      manage_plan_member: {
        Args: { p_action: string; p_email: string; p_entitlement_id: string };
        Returns: Json;
      };
      mark_evidence_deleted: {
        Args: { p_artifact: string; p_claim_token: string };
        Returns: boolean;
      };
      mark_media_deleted: {
        Args: { p_claim_token: string; p_object_id: string };
        Returns: boolean;
      };
      mark_my_notifications_read: { Args: { p_ids?: string[] }; Returns: Json };
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
      my_organisation_links: { Args: Record<PropertyKey, never>; Returns: Json };
      my_partner_dashboard: { Args: Record<PropertyKey, never>; Returns: Json };
      my_posting_capacity: { Args: Record<PropertyKey, never>; Returns: Json };
      my_queue_claims: { Args: Record<PropertyKey, never>; Returns: Json };
      my_sponsorships: { Args: Record<PropertyKey, never>; Returns: Json };
      open_verification_case: { Args: Record<PropertyKey, never>; Returns: Json };
      org_decide_application: {
        Args: { p_application: string; p_decision: string; p_note?: string };
        Returns: Json;
      };
      org_list_affiliations: { Args: { p_org: string }; Returns: Json };
      org_list_applications: { Args: { p_org: string; p_status?: string }; Returns: Json };
      org_list_sponsorships: { Args: { p_org: string }; Returns: Json };
      org_update_affiliation: {
        Args: { p_action: string; p_affiliation: string; p_value: string };
        Returns: Json;
      };
      place_evidence_fraud_hold: { Args: { p_case_id: string; p_reason: string }; Returns: Json };
      place_legal_hold: { Args: { p_reason: string; p_subject_id: string }; Returns: Json };
      preview_duplicate_events: { Args: { p_post_a: string; p_post_b: string }; Returns: Json };
      preview_organisation_invite: { Args: { p_token_hash: string }; Returns: Json };
      propose_decision: {
        Args: { p_action: string; p_case_id: string; p_expected_version: number; p_payload: Json };
        Returns: Json;
      };
      propose_verified_identity_ban: {
        Args: { p_category: string; p_fact: string; p_owner: string; p_request: string };
        Returns: Json;
      };
      public_organisation_directory: { Args: Record<PropertyKey, never>; Returns: Json };
      public_post_affiliations: { Args: { p_post_ids: string[] }; Returns: Json };
      public_post_sponsorships: { Args: { p_post_ids: string[] }; Returns: Json };
      public_programme_showcases: { Args: { p_placement: string }; Returns: Json };
      purge_expired_identity_bans: { Args: { p_limit: number }; Returns: number };
      purge_expired_inbox: { Args: { p_limit: number }; Returns: Json };
      purge_expired_trial_identities: { Args: { p_limit: number }; Returns: number };
      read_listing_price_draft: { Args: Record<PropertyKey, never>; Returns: Json };
      reassign_queue_claim: {
        Args: { p_id: string; p_reason: string; p_subject: string; p_to: string };
        Returns: Json;
      };
      reconcile_intro_trials: { Args: { p_limit?: number }; Returns: number };
      reconcile_verified_identity_ban: { Args: { p_decision: string }; Returns: Json };
      record_my_acquisition: {
        Args: {
          p_campaign?: string;
          p_first_touch_at?: string;
          p_landing_path?: string;
          p_organisation_slug?: string;
          p_partner_code?: string;
          p_referrer_host?: string;
          p_source?: string;
          p_utm: Json;
        };
        Returns: Json;
      };
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
      release_evidence_claim: {
        Args: { p_case: string; p_claim_generation: string; p_claim_nonce: string };
        Returns: boolean;
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
      remove_organisation_admin: {
        Args: { p_account: string; p_org: string; p_reason: string };
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
      return_identity_submission: {
        Args: {
          p_case: string;
          p_claim_generation: string;
          p_claim_nonce: string;
          p_expected_version: number;
          p_reason: string;
        };
        Returns: Json;
      };
      reveal_post_phone: { Args: { p_channel: string; p_post_id: string }; Returns: string };
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
      revoke_organisation_invite: { Args: { p_invite: string; p_reason: string }; Returns: Json };
      run_post_lifecycle: { Args: { p_limit: number }; Returns: Json };
      run_retention: { Args: { p_limit: number }; Returns: Json };
      save_business_event_context: {
        Args: { p_expected_revision: number; p_patch: Json; p_post_id: string };
        Returns: Json;
      };
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
      save_my_legal_name: {
        Args: { p_expected_revision: number; p_first_name: string; p_last_name: string };
        Returns: Json;
      };
      save_my_profile: {
        Args: { p_bio?: string; p_display_name?: string; p_expected_revision: number };
        Returns: Json;
      };
      save_organisation_programme: {
        Args: {
          p_active?: boolean;
          p_description?: string;
          p_name: string;
          p_org: string;
          p_reason: string;
          p_slug: string;
        };
        Returns: Json;
      };
      save_post_content: {
        Args: { p_content: Json; p_expected_revision: number; p_post_id: string };
        Returns: Json;
      };
      save_programme_showcase: {
        Args: {
          p_city?: string;
          p_display_order: number;
          p_enabled: boolean;
          p_ends_at: string;
          p_expected_revision?: number;
          p_max_cards: number;
          p_org: string;
          p_placement: string;
          p_programme?: string;
          p_province?: string;
          p_reason: string;
          p_showcase?: string;
          p_sponsored_only: boolean;
          p_starts_at: string;
          p_title: string;
        };
        Returns: Json;
      };
      search_post_cards: { Args: { p_request: Json }; Returns: Json };
      search_posts: { Args: { p_request: Json }; Returns: Json };
      set_enquiry_status: { Args: { p_id: string; p_status: string }; Returns: Json };
      set_my_avatar: { Args: { p_expected_revision: number; p_object_id?: string }; Returns: Json };
      set_organisation_logo: {
        Args: {
          p_expected_revision: number;
          p_id: string;
          p_object_id?: string;
          p_permission_reference?: string;
          p_reason: string;
        };
        Returns: Json;
      };
      set_post_contacts: {
        Args: { p_channels: Json; p_expected_revision: number; p_post_id: string };
        Returns: Json;
      };
      set_post_media: {
        Args: { p_expected_revision: number; p_items: Json; p_post_id: string };
        Returns: Json;
      };
      set_post_state: {
        Args: { p_action: string; p_expected_revision: number; p_post_id: string };
        Returns: Json;
      };
      sponsor_business: { Args: { p_affiliation: string; p_reason: string }; Returns: Json };
      staff_cost_overview: { Args: Record<PropertyKey, never>; Returns: Json };
      staff_decide_commission: {
        Args: { p_action: string; p_commission: string; p_reason: string; p_reference?: string };
        Returns: Json;
      };
      staff_evidence_metadata: {
        Args: {
          p_case_id: string;
          p_claim_generation: string;
          p_claim_nonce: string;
          p_purpose: string;
        };
        Returns: Json;
      };
      staff_get_organisation: { Args: { p_id: string }; Returns: Json };
      staff_identity_history: {
        Args: { p_before_id?: string; p_before_time?: string; p_owner: string };
        Returns: Json;
      };
      staff_identity_review_context: {
        Args: { p_case: string; p_claim_generation: string; p_claim_nonce: string };
        Returns: Json;
      };
      staff_list_commissions: { Args: { p_partner?: string; p_status?: string }; Returns: Json };
      staff_list_organisations: { Args: Record<PropertyKey, never>; Returns: Json };
      staff_list_partners: { Args: Record<PropertyKey, never>; Returns: Json };
      staff_list_programme_showcases: { Args: { p_org: string }; Returns: Json };
      staff_review_post: {
        Args: { p_claim_generation: string; p_claim_nonce: string; p_post_id: string };
        Returns: Json;
      };
      staff_review_report: {
        Args: { p_claim_generation: string; p_claim_nonce: string; p_report_id: string };
        Returns: Json;
      };
      staff_save_partner: {
        Args: {
          p_account: string;
          p_action: string;
          p_code?: string;
          p_commission_bps?: number;
          p_reason: string;
        };
        Returns: Json;
      };
      staff_verification_queue: { Args: { p_limit: number }; Returns: Json };
      start_checkout: { Args: { p_product_id: string; p_target_post?: string }; Returns: Json };
      submit_enquiry: {
        Args: {
          p_buyer_email: string;
          p_buyer_name?: string;
          p_buyer_phone?: string;
          p_message: string;
          p_post_id: string;
          p_request_id: string;
          p_sender?: string;
        };
        Returns: Json;
      };
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
      sweep_sponsorships: { Args: { p_limit: number }; Returns: Json };
      update_my_application: {
        Args: { p_action: string; p_application: string; p_response?: string };
        Returns: Json;
      };
      update_organisation: {
        Args: { p_expected_revision: number; p_id: string; p_patch: Json; p_reason: string };
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
