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
      return "Unauthorized";
    case "forbidden":
      return "Access denied";
    case "no_active_case":
      return "No active case";
    case "not_linked":
      return "Not linked to active session";
    case "not_found":
      return "Missing file";
    case "missing_file":
      return "Missing file";
    case "rate_limited":
      return "Too many requests";
    case "server_error":
      return "Server error";
    default:
      return fallback;
  }
}
