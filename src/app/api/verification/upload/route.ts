import { type NextRequest } from "next/server";
import { handleRestoredVerificationUpload } from "@/lib/foundation/restored-verification-upload";

/**
 * POST /api/verification/upload
 *
 * Upload an ID document or selfie. Location is submitted as province and city.
 * Files are encrypted before storage for POPIA compliance.
 *
 * Accepts multipart/form-data with:
 * - file: the document file (image or PDF, max 5MB)
 * - docType: "id_document" | "selfie"
 * - idNumber: (optional) SA ID number for id_document step
 * - idDocumentType: (optional) "sa_id"
 */
export async function POST(request: NextRequest) {
  return handleRestoredVerificationUpload(request);
}
