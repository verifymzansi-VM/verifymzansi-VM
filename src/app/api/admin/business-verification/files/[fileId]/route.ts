/**
 * GET /api/admin/business-verification/files/[fileId]
 * Decrypts and serves one business verification file to staff. Every view
 * is logged first; if the log cannot be written nothing is served. Files
 * with active content are never served — staff get the extracted text.
 */
import { type NextRequest, NextResponse } from "next/server";

import { authorizeEvidenceRequest } from "@/app/api/admin/verification/_lib/evidence-route-auth";
import { detectEvidenceContentType, hashIp } from "@/lib/services/evidence-serving";
import { downloadKycDocument } from "@/lib/services/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { uuidSchema } from "@/lib/validations/shared";

const log = createLogger("BusinessVerificationEvidence");
const NO_STORE = "no-store, no-cache, must-revalidate";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const auth = await authorizeEvidenceRequest({ log, rateLimitAction: "admin:evidence:view" });
    if (!auth.success) return auth.response;

    const fileId = uuidSchema.safeParse((await params).fileId);
    if (!fileId.success) return NextResponse.json({ error: "Invalid file" }, { status: 400 });

    const ipHashSecret = process.env.IP_HASH_SECRET;
    if (!ipHashSecret && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Service configuration error" }, { status: 503 });
    }

    const admin = createAdminClient();
    const { data: file, error } = await admin
      .from("business_verification_files")
      .select(
        "id, case_id, r2_key, quarantined, extracted_text, purged_at, business_verifications!inner(owner_id, business_id)"
      )
      .eq("id", fileId.data)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });
    const verification = file.business_verifications as unknown as {
      owner_id: string;
      business_id: string;
    };
    // Neither the owner who applied nor whoever owns the business now.
    const { data: business } = await admin
      .from("businesses")
      .select("owner_id")
      .eq("id", verification.business_id)
      .maybeSingle();
    if (verification.owner_id === auth.user.id || business?.owner_id === auth.user.id) {
      return NextResponse.json({ error: "You can't review your own business." }, { status: 403 });
    }
    if (file.purged_at) {
      return NextResponse.json(
        { error: "This file was deleted under our retention policy.", code: "purged" },
        { status: 410 }
      );
    }

    const ip =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const { error: logError } = await admin
      .from("business_verification_evidence_access_logs")
      .insert({
        actor_id: auth.user.id,
        actor_role: auth.role,
        case_id: file.case_id,
        file_id: file.id,
        action: "view_file",
        ip_hash: hashIp(ip, ipHashSecret),
      });
    if (logError) {
      log.error("Could not log evidence access; refusing to serve", { error: logError.message });
      return NextResponse.json(
        { error: "Evidence access could not be recorded. Please try again." },
        { status: 503 }
      );
    }

    if (file.quarantined) {
      return new NextResponse(file.extracted_text ?? "No text could be read from this file.", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": NO_STORE,
          "X-Content-Type-Options": "nosniff",
          "X-Quarantined": "1",
        },
      });
    }

    const buffer = await downloadKycDocument(file.r2_key);
    const contentType = detectEvidenceContentType(buffer);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType ?? "application/octet-stream",
        "Content-Disposition": contentType ? "inline" : "attachment",
        "Cache-Control": NO_STORE,
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
      },
    });
  } catch (error) {
    log.error("Serving business verification file failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not load the file" }, { status: 500 });
  }
}
