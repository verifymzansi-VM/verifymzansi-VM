import { NextResponse, type NextRequest } from "next/server";

import { isIntakeError, readCipcFile } from "@/lib/business-verification/intake";
import {
  discardStoredFile,
  fileRow,
  screenUpload,
  storeCaseFile,
} from "@/lib/business-verification/service";
import { normaliseRegistrationNumber } from "@/lib/cipc/parse";
import { notifyStaffForAdminEvent } from "@/lib/notifications";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";

import { requireVerificationOwner } from "../_lib/owner-guard";
import { formFile, formText, readVerificationForm } from "../_lib/read-upload";

const log = createLogger("BusinessVerificationSubmit");

/**
 * POST /api/businesses/[id]/verification/cipc
 * Submits a CIPC document for staff review. The upload is evidence only:
 * staff approve from a copy they fetch from CIPC themselves.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let storedKey: string | null = null;
  try {
    const ctx = await requireVerificationOwner(request, params, {
      log,
      mutation: true,
      rateAction: "business-verification:submit",
    });
    if (ctx instanceof NextResponse) return ctx;
    const { admin, business, userId } = ctx;

    const form = await readVerificationForm(request);
    if (form instanceof NextResponse) return form;
    const upload = formFile(form, "file");
    if (!upload) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    const enteredNumber = formText(form, "registrationNumber", 30);
    const route = formText(form, "route") === "representative" ? "representative" : "director";

    const file = await readCipcFile(upload);
    if (isIntakeError(file)) {
      return NextResponse.json({ error: file.error, code: file.code }, { status: file.status });
    }

    const { findings, registrationNumber } = await screenUpload(admin, {
      file,
      userId,
      businessId: business.id,
      businessName: business.business_name,
      enteredNumber,
    });
    if (!registrationNumber) {
      return NextResponse.json(
        {
          error: "We couldn't read the registration number. Type it as shown, e.g. 2020/123456/07.",
          code: "registration_number_required",
        },
        { status: 400 }
      );
    }
    if (enteredNumber && !normaliseRegistrationNumber(enteredNumber)) {
      return NextResponse.json(
        {
          error: "Registration numbers look like 2020/123456/07.",
          code: "registration_number_invalid",
        },
        { status: 400 }
      );
    }

    storedKey = await storeCaseFile(file, userId, "cipc");

    const { data: created, error: caseError } = await admin
      .from("business_verifications")
      .insert({
        business_id: business.id,
        owner_id: userId,
        kind: "cipc",
        route,
        registration_number: registrationNumber,
        doc_type: file.stored?.docType ?? null,
        parsed: file.stored ?? {},
        director_id_hmacs: file.directorIdHmacs,
        findings,
        registered_office: file.office,
      })
      .select("id")
      .single();
    if (caseError || !created) {
      await discardStoredFile(storedKey);
      if (caseError?.code === "23505") {
        return NextResponse.json(
          { error: "This business already has a verification in review.", code: "case_open" },
          { status: 409 }
        );
      }
      throw new Error(caseError?.message ?? "case insert failed");
    }

    const { error: fileError } = await admin.from("business_verification_files").insert(
      fileRow(file, {
        caseId: created.id,
        kind: "owner_upload",
        uploadedBy: userId,
        r2Key: storedKey,
      })
    );
    if (fileError) {
      await admin.from("business_verifications").delete().eq("id", created.id);
      await discardStoredFile(storedKey);
      throw new Error(fileError.message);
    }

    await Promise.all([
      logAuditEvent({
        actorId: userId,
        actorRole: "member",
        action: "business_verification_submitted",
        targetType: "business",
        targetId: business.id,
        area: "MZANSI_BUSINESS",
        metadata: {
          caseId: created.id,
          kind: "cipc",
          route,
          docType: file.stored?.docType ?? null,
        },
      }),
      notifyStaffForAdminEvent({
        capability: "queue:view",
        type: "info",
        title: "Business verification submitted",
        message: `${business.business_name} sent a CIPC document for review.`,
        href: `/admin/business-verification/${created.id}`,
        excludeUserId: userId,
      }),
    ]);

    return NextResponse.json({ caseId: created.id, status: "pending" }, { status: 201 });
  } catch (error) {
    log.error("CIPC submission failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "We couldn't send your document. Please try again." },
      { status: 500 }
    );
  }
}
