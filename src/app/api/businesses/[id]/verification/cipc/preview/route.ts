import { NextResponse, type NextRequest } from "next/server";

import { isIntakeError, readCipcFile } from "@/lib/business-verification/intake";
import { ownerIdHmac, ownerPreview } from "@/lib/business-verification/service";
import { createLogger } from "@/lib/utils/logger";

import { requireVerificationOwner } from "../../_lib/owner-guard";
import { formFile, readVerificationForm } from "../../_lib/read-upload";

const log = createLogger("BusinessVerificationPreview");

/**
 * POST /api/businesses/[id]/verification/cipc/preview
 * Reads a CIPC document so the owner can confirm what we found before
 * submitting. Nothing is stored and nothing is decided here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireVerificationOwner(request, params, {
      log,
      mutation: true,
      rateAction: "business-verification:preview",
    });
    if (ctx instanceof NextResponse) return ctx;

    const form = await readVerificationForm(request);
    if (form instanceof NextResponse) return form;
    const upload = formFile(form, "file");
    if (!upload) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });

    const file = await readCipcFile(upload);
    if (isIntakeError(file)) {
      return NextResponse.json({ error: file.error, code: file.code }, { status: file.status });
    }

    const hmac = await ownerIdHmac(ctx.admin, ctx.userId);
    return NextResponse.json({ preview: ownerPreview(file, hmac) });
  } catch (error) {
    log.error("CIPC preview failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "We couldn't read that file. Please try again." },
      { status: 500 }
    );
  }
}
