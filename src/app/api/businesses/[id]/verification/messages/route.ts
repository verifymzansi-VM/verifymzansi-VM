import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isIntakeError, readCipcFile } from "@/lib/business-verification/intake";
import { withoutException, type AdminCopy } from "@/lib/business-verification/decide";
import {
  discardStoredFile,
  fileRow,
  notifyConflictHolders,
  screenUpload,
  storeCaseFile,
} from "@/lib/business-verification/service";
import { compareWithAdminCopy } from "@/lib/cipc/screen";
import { notifyStaffForAdminEvent } from "@/lib/notifications";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";

import { requireVerificationOwner } from "../_lib/owner-guard";
import { formFile, formText, readVerificationForm } from "../_lib/read-upload";

const log = createLogger("BusinessVerificationOwnerMessage");

const caseIdSchema = z.string().uuid();

/**
 * POST /api/businesses/[id]/verification/messages
 * The owner replies to staff, optionally with a new document. A new CIPC
 * document is re-read and replaces the evidence staff compare; the case goes
 * back to the review queue.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let storedKey: string | null = null;
  try {
    const ctx = await requireVerificationOwner(request, params, {
      log,
      mutation: true,
      rateAction: "business-verification:message",
    });
    if (ctx instanceof NextResponse) return ctx;
    const { admin, business, userId } = ctx;

    const form = await readVerificationForm(request);
    if (form instanceof NextResponse) return form;
    const caseId = caseIdSchema.safeParse(formText(form, "caseId", 64));
    const body = formText(form, "body", 2000);
    const upload = formFile(form, "file");
    if (!caseId.success) return NextResponse.json({ error: "Invalid case" }, { status: 400 });
    if (!body && !upload) {
      return NextResponse.json({ error: "Write a message or attach a file." }, { status: 400 });
    }

    const { data: openCase, error: caseError } = await admin
      .from("business_verifications")
      .select(
        "id, kind, status, owner_id, business_id, registration_number, admin_copy, checks, updated_at"
      )
      .eq("id", caseId.data)
      .eq("business_id", business.id)
      .maybeSingle();
    if (caseError) throw new Error(caseError.message);
    if (!openCase || openCase.owner_id !== userId) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    if (!["pending", "info_requested"].includes(openCase.status)) {
      return NextResponse.json(
        { error: "This case is closed. Start a new verification instead.", code: "case_closed" },
        { status: 409 }
      );
    }

    let attachmentId: string | null = null;
    let newClaimNotice: (() => Promise<void>) | null = null;
    const casePatch: Record<string, unknown> = { status: "pending" };

    if (upload) {
      const file = await readCipcFile(upload);
      if (isIntakeError(file)) {
        return NextResponse.json({ error: file.error, code: file.code }, { status: file.status });
      }
      storedKey = await storeCaseFile(file, userId, "message");
      const isCipcCase = openCase.kind === "cipc";
      const { data: fileRowData, error: fileError } = await admin
        .from("business_verification_files")
        .insert(
          fileRow(file, {
            caseId: openCase.id,
            kind: isCipcCase ? "owner_upload" : "message_attachment",
            uploadedBy: userId,
            r2Key: storedKey,
          })
        )
        .select("id")
        .single();
      if (fileError || !fileRowData) {
        await discardStoredFile(storedKey);
        throw new Error(fileError?.message ?? "file insert failed");
      }
      attachmentId = fileRowData.id;

      if (isCipcCase) {
        const { findings, registrationNumber, conflictHolders } = await screenUpload(admin, {
          file,
          userId,
          businessId: business.id,
          businessName: business.business_name,
          enteredNumber: null,
        });
        // Staff compared the old document; compare the new one with their copy.
        const adminCopy = openCase.admin_copy as AdminCopy | null;
        const reCompared = adminCopy
          ? {
              ...adminCopy,
              differences: compareWithAdminCopy(
                {
                  registrationNumber: file.stored?.registrationNumber ?? null,
                  registeredName: file.stored?.registeredName ?? null,
                  enterpriseStatus: file.stored?.enterpriseStatus ?? null,
                  registeredOfficeLines: file.stored?.registeredOfficeLines ?? [],
                },
                {
                  registrationNumber: adminCopy.registrationNumber,
                  registeredName: adminCopy.registeredName,
                  enterpriseStatus: adminCopy.enterpriseStatus,
                  registeredOfficeLines: adminCopy.registeredOfficeLines ?? [],
                },
                file.directorIdHmacs,
                adminCopy.directors.flatMap((d) => (d.idHmac ? [d.idHmac] : []))
              ),
            }
          : null;
        Object.assign(casePatch, {
          doc_type: file.stored?.docType ?? null,
          parsed: file.stored ?? {},
          director_id_hmacs: file.directorIdHmacs,
          findings,
          registered_office: file.office,
          ...(registrationNumber ? { registration_number: registrationNumber } : {}),
          ...(reCompared ? { admin_copy: reCompared } : {}),
          // New evidence voids an exception proposed on the old document.
          checks: withoutException(openCase.checks as Record<string, unknown> | null),
        });
        if (registrationNumber && registrationNumber !== openCase.registration_number) {
          newClaimNotice = () => notifyConflictHolders(admin, conflictHolders, registrationNumber);
        }
      }
    }

    // Update the case first: if it closed meanwhile, nothing is recorded.
    const { data: updated, error: updateError } = await admin
      .from("business_verifications")
      .update(casePatch)
      .eq("id", openCase.id)
      .in("status", ["pending", "info_requested"])
      .select("id");
    if (updateError) throw new Error(updateError.message);
    if (!updated?.length) {
      if (attachmentId) {
        await admin.from("business_verification_files").delete().eq("id", attachmentId);
      }
      if (storedKey) await discardStoredFile(storedKey);
      return NextResponse.json(
        { error: "This case just closed. Start a new verification instead.", code: "case_closed" },
        { status: 409 }
      );
    }

    const { error: messageError } = await admin.from("business_verification_messages").insert({
      case_id: openCase.id,
      author_id: userId,
      author_role: "owner",
      body: body ?? "Sent a new document.",
      attachment_file_id: attachmentId,
    });
    if (messageError) throw new Error(messageError.message);
    if (newClaimNotice) await newClaimNotice();

    await Promise.all([
      logAuditEvent({
        actorId: userId,
        actorRole: "member",
        action: "business_verification_owner_replied",
        targetType: "business",
        targetId: business.id,
        area: "MZANSI_BUSINESS",
        metadata: { caseId: openCase.id, withFile: Boolean(upload) },
      }),
      notifyStaffForAdminEvent({
        capability: "queue:view",
        type: "info",
        title: "Business owner replied",
        message: `${business.business_name} replied on their verification.`,
        href: `/admin/business-verification/${openCase.id}`,
        excludeUserId: userId,
      }),
    ]);

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    log.error("Owner verification message failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "We couldn't send that. Please try again." },
      { status: 500 }
    );
  }
}
