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
      get_my_dashboard: { Args: Record<PropertyKey, never>; Returns: Json };
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
