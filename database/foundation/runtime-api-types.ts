// Reviewed additive APIs for the already-provisioned database. The immutable
// clean-baseline generator artifacts remain in api-role-types.ts.
import type { Json } from "./api.types";
import type { FoundationAuthenticatedDatabase as Baseline } from "./api-role-types";
export type FoundationRuntimeAuthenticatedDatabase = {
  api: Omit<Baseline["api"], "Functions"> & {
    Functions: Baseline["api"]["Functions"] & {
      get_my_dashboard: { Args: Record<PropertyKey, never>; Returns: Json };
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
