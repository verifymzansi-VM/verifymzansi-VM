export type KycEvidenceErrorCode =
  | "unauthorized"
  | "forbidden"
  | "no_active_case"
  | "not_linked"
  | "not_found"
  | "missing_file"
  | "rate_limited"
  | "server_error";

export function getKycEvidenceErrorMessage(
  code?: string | null,
  fallback = "Failed to load metadata"
): string {
  switch (code) {
    case "unauthorized":
      return "Unauthorized — please log in";
    case "forbidden":
      return "Access denied — insufficient permissions";
    case "no_active_case":
      return "No active verification case for this user";
    case "not_linked":
      return "Evidence not linked to current verification session";
    case "not_found":
      return "Evidence record not found";
    case "missing_file":
      return "Evidence file is missing from storage (may have been purged or dropped)";
    case "rate_limited":
      return "Too many requests — please try again in a moment";
    case "server_error":
      return "Server error retrieving evidence — please contact support";
    default:
      return fallback;
  }
}
