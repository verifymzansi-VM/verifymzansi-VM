import { NextResponse } from "next/server";

import { isIntakeError, readCipcFile } from "@/lib/business-verification/intake";
import { discardStoredFile, fileRow, storeCaseFile } from "@/lib/business-verification/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { internalApiError, logApiError } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { loadOpenSeenCase, readStaffUpload, requireStaffCase } from "../../_lib/staff-guard";

const log = createLogger("AdminBusinessVerificationVisitPhoto");

function coordinate(value: FormDataEntryValue | null, limit: number): number | null {
  const n = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n * 1e5) / 1e5 : null;
}

/**
 * POST /api/admin/business-verification/[id]/visit-photo
 * The assigned verifier adds a photo (visit) or screenshot (video call).
 * Server time is recorded; for visits the browser's location is kept with
 * the photo as evidence. Photos are private and deleted with the case files.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let storedKey: string | null = null;
  try {
    // The assigned verifier works their booked check without re-claiming it
    // (claims last 15 minutes; a visit is days later). Checked below.
    const guard = await requireStaffCase(request, params, {
      log,
      capability: "queue:claim",
      requireClaim: false,
    });
    if (guard instanceof NextResponse) return guard;
    const received = await readStaffUpload(request, "Choose a photo.");
    if (received instanceof NextResponse) return received;
    const { form, file: upload } = received;

    const row = await loadOpenSeenCase(guard);
    if (row instanceof NextResponse) return row;
    const admin = createAdminClient();
    const seen = row.seen;
    if (seen.assignedTo !== guard.user.id) {
      return NextResponse.json({ error: "Book the check before adding photos." }, { status: 403 });
    }
    if (seen.report) {
      return NextResponse.json({ error: "The report is already sent." }, { status: 409 });
    }

    const file = await readCipcFile(upload);
    if (isIntakeError(file)) {
      return NextResponse.json({ error: file.error, code: file.code }, { status: file.status });
    }
    if (file.isPdf)
      return NextResponse.json({ error: "Upload a photo, not a PDF." }, { status: 400 });

    storedKey = await storeCaseFile(file, guard.user.id, "visit-photo");
    const { data: stored, error: fileError } = await admin
      .from("business_verification_files")
      .insert(
        fileRow(file, {
          caseId: row.id,
          kind: "visit_photo",
          uploadedBy: guard.user.id,
          r2Key: storedKey,
        })
      )
      .select("id")
      .single();
    if (fileError || !stored) {
      await discardStoredFile(storedKey);
      throw new Error(fileError?.message ?? "file insert failed");
    }

    const photo = {
      fileId: stored.id as string,
      takenAt: new Date().toISOString(),
      lat: seen.method === "visit" ? coordinate(form.get("lat"), 90) : null,
      lng: seen.method === "visit" ? coordinate(form.get("lng"), 180) : null,
      by: guard.user.id,
    };
    // One atomic append, only for the assigned verifier and before the report.
    const { data: appended, error: appendError } = await admin.rpc("append_seen_photo", {
      p_case: row.id,
      p_actor: guard.user.id,
      p_photo: photo,
    });
    if (appendError || appended !== true) {
      await admin.from("business_verification_files").delete().eq("id", stored.id);
      await discardStoredFile(storedKey);
      if (appendError) throw new Error(appendError.message);
      return NextResponse.json(
        { error: "This check changed (report sent or reassigned). Reload the case." },
        { status: 409 }
      );
    }

    return NextResponse.json({ photo }, { status: 201 });
  } catch (error) {
    logApiError(log, "Adding visit photo failed", error);
    return internalApiError();
  }
}
