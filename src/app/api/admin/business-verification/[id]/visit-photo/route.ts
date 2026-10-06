import { NextResponse } from "next/server";

import { isIntakeError, readCipcFile } from "@/lib/business-verification/intake";
import type { SeenState } from "@/lib/business-verification/seen";
import { discardStoredFile, fileRow, storeCaseFile } from "@/lib/business-verification/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { internalApiError, logApiError } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { readStaffUpload, requireStaffCase } from "../../_lib/staff-guard";

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
    const guard = await requireStaffCase(request, params, { log, capability: "queue:claim" });
    if (guard instanceof NextResponse) return guard;
    const received = await readStaffUpload(request, "Choose a photo.");
    if (received instanceof NextResponse) return received;
    const { form, file: upload } = received;

    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from("business_verifications")
      .select("id, owner_id, kind, status, seen")
      .eq("id", guard.caseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.kind !== "seen" || row.status !== "pending") {
      return NextResponse.json({ error: "Open Seen case not found" }, { status: 404 });
    }
    const seen = (row.seen ?? {}) as SeenState;
    if (seen.assignedTo !== guard.user.id) {
      return NextResponse.json({ error: "Book the check before adding photos." }, { status: 403 });
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

    // Re-read so concurrent uploads don't overwrite each other's entries.
    const { data: fresh } = await admin
      .from("business_verifications")
      .select("seen")
      .eq("id", row.id)
      .single();
    const current = ((fresh?.seen ?? seen) as SeenState) ?? seen;
    const photo = {
      fileId: stored.id as string,
      takenAt: new Date().toISOString(),
      lat: seen.method === "visit" ? coordinate(form.get("lat"), 90) : null,
      lng: seen.method === "visit" ? coordinate(form.get("lng"), 180) : null,
      by: guard.user.id,
    };
    const { error: updateError } = await admin
      .from("business_verifications")
      .update({ seen: { ...current, photos: [...(current.photos ?? []), photo] } })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ photo }, { status: 201 });
  } catch (error) {
    logApiError(log, "Adding visit photo failed", error);
    return internalApiError();
  }
}
