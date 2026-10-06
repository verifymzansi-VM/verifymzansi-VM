import { NextResponse } from "next/server";

import type { AdminCopy } from "@/lib/business-verification/decide";
import { isIntakeError, readCipcFile, type StoredParse } from "@/lib/business-verification/intake";
import { discardStoredFile, fileRow, storeCaseFile } from "@/lib/business-verification/service";
import { compareWithAdminCopy } from "@/lib/cipc/screen";
import { logAuditEvent } from "@/lib/services/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { internalApiError, logApiError } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { readStaffUpload, requireStaffCase } from "../../_lib/staff-guard";

const log = createLogger("AdminBusinessVerificationCopy");

/**
 * POST /api/admin/business-verification/[id]/admin-copy
 * Staff attach the disclosure they fetched from CIPC themselves. It is the
 * source of truth for approval; we parse it and compare it with the owner's
 * upload field by field.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let storedKey: string | null = null;
  try {
    const ctx = await requireStaffCase(request, params, { log });
    if (ctx instanceof NextResponse) return ctx;
    const guard = ctx;
    const received = await readStaffUpload(request, "Attach the CIPC copy you downloaded.");
    if (received instanceof NextResponse) return received;
    const { form, file: upload } = received;
    const reference =
      String(form.get("cipcReference") ?? "")
        .trim()
        .slice(0, 80) || null;

    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from("business_verifications")
      .select("id, owner_id, kind, status, parsed, director_id_hmacs, business_id")
      .eq("id", ctx.caseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.kind !== "cipc")
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    if (!["pending", "info_requested"].includes(row.status)) {
      return NextResponse.json({ error: "This case is closed." }, { status: 409 });
    }

    const file = await readCipcFile(upload);
    if (isIntakeError(file)) {
      return NextResponse.json({ error: file.error, code: file.code }, { status: file.status });
    }
    if (!file.stored || file.stored.docType === "unknown") {
      return NextResponse.json(
        {
          error:
            "That isn't a readable CIPC PDF. Download the disclosure from CIPC and attach it unchanged.",
          code: "admin_copy_unreadable",
        },
        { status: 400 }
      );
    }

    const owner = row.parsed as StoredParse;
    const copy: AdminCopy = {
      registrationNumber: file.stored.registrationNumber,
      registeredName: file.stored.registeredName,
      enterpriseStatus: file.stored.enterpriseStatus,
      directors: file.stored.directors.map((d) => ({
        name: d.name,
        role: d.role,
        idHmac: d.idHmac,
      })),
      registeredOffice: file.office,
      cipcReference: reference,
      differences: compareWithAdminCopy(
        {
          registrationNumber: owner.registrationNumber ?? null,
          registeredName: owner.registeredName ?? null,
          enterpriseStatus: owner.enterpriseStatus ?? null,
          registeredOfficeLines: owner.registeredOfficeLines ?? [],
        },
        file.stored,
        (row.director_id_hmacs as string[]) ?? [],
        file.directorIdHmacs
      ),
    };

    storedKey = await storeCaseFile(file, guard.user.id, "admin-copy");
    const { error: fileError } = await admin.from("business_verification_files").insert(
      fileRow(file, {
        caseId: row.id,
        kind: "admin_copy",
        uploadedBy: guard.user.id,
        r2Key: storedKey,
      })
    );
    if (fileError) {
      await discardStoredFile(storedKey);
      throw new Error(fileError.message);
    }

    // CIPC's own record is the source for the registered office.
    const { error: updateError } = await admin
      .from("business_verifications")
      .update({ admin_copy: copy, registered_office: file.office })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);

    await logAuditEvent({
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      action: "business_verification_admin_copy_attached",
      targetType: "business",
      targetId: row.business_id,
      area: "MZANSI_BUSINESS",
      metadata: { caseId: row.id, differences: copy.differences.length, reference },
    });

    return NextResponse.json({ adminCopy: copy });
  } catch (error) {
    logApiError(log, "Attaching admin CIPC copy failed", error);
    return internalApiError();
  }
}
