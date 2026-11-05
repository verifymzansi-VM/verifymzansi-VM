import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createFoundationServiceApi } from "./service-api";
import {
  key,
  privateBucket,
  protectBusinessEvidenceRoute,
  reservation,
  sha,
  storeBusinessEvidence,
} from "./business-evidence-route";
import { readMyBusinessChecks, visitPhotoReceipt } from "./business-seen";
import { FoundationStaffCommandError, settleStaffCommand } from "./staff-command";
import { getR2ObjectBytes } from "../services/storage";
import { decryptData } from "../utils/encryption";
import { readBoundedRequestFormData } from "../utils/request-body";
import { detectMimeFromMagicBytes } from "../utils/file-validation";
import { evidenceViewResponse } from "../services/evidence-serving";
import { isIntakeError, readCipcFile } from "../business-verification/intake";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const imageMime = z.enum(["image/jpeg", "image/png", "image/webp"]);
const evidenceMime = z.enum([...imageMime.options, "application/pdf"]);
export function uploadSeenPhoto(incoming: Request, id: string) {
  return protectBusinessEvidenceRoute(
    incoming,
    "business-verification:visit-photo",
    true,
    async ({ api }, request) => {
      const caseId = z.uuid().parse(id);
      const form = await readBoundedRequestFormData(request, 6 * 1024 * 1024);
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        [...form.keys()].some(
          (field) => !["file", "lat", "lng"].includes(field) || form.getAll(field).length !== 1
        )
      )
        return NextResponse.json({ error: "Choose one photograph." }, { status: 400 });
      const data = await readCipcFile(file);
      if (isIntakeError(data))
        return NextResponse.json({ error: data.error, code: data.code }, { status: data.status });
      if (data.isPdf || data.activeContent)
        return NextResponse.json(
          { error: "Choose a safe photograph, not a PDF." },
          { status: 400 }
        );
      const bytes = Buffer.from(data.bytes);
      const mime = imageMime.parse(detectMimeFromMagicBytes(bytes));
      const coordinates = (name: "lat" | "lng", limit: number) => {
        const raw = form.get(name);
        const number = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
        return Number.isFinite(number) && Math.abs(number) <= limit
          ? Math.round(number * 1e5) / 1e5
          : undefined;
      };
      const contentHash = sha(bytes);
      const reserved = await settleStaffCommand(
        api.rpc(
          "reserve_frontend_seen_photo",
          {
            p_case: caseId,
            p_digest: contentHash,
            p_mime: mime,
            p_lat: coordinates("lat", 90),
            p_lng: coordinates("lng", 180),
          },
          { get: false }
        ),
        reservation
      );
      await storeBusinessEvidence(reserved, caseId, bytes, "business_visit_photo");
      const photo = await settleStaffCommand(
        api.rpc(
          "get_frontend_seen_photo_receipt",
          {
            p_case: caseId,
            p_artifact: reserved.artifact_id,
          },
          { get: false }
        ),
        visitPhotoReceipt.refine((p) => p.fileId === reserved.artifact_id)
      );
      return NextResponse.json({ photo }, { status: 201 });
    }
  );
}

export function readSeenEvidenceFile(incoming: Request, id: string) {
  return protectBusinessEvidenceRoute(incoming, "admin:evidence:view", false, async ({ api }) => {
    const artifact = z.uuid().parse(id);
    const scope = z.strictObject({
      case_id: z.uuid(),
      artifact_id: z.literal(artifact),
      version: z.number().int().positive(),
    });
    const authorize = async (record: boolean) => {
      const result = await api.rpc(
        "authorize_frontend_seen_file",
        { p_artifact: artifact, p_record: record },
        { get: false }
      );
      if (result.error?.code === "PT404")
        throw new FoundationStaffCommandError(404, "This file is no longer available.");
      return settleStaffCommand(Promise.resolve(result), scope);
    };
    const before = await authorize(false);
    const object = await settleStaffCommand(
      createFoundationServiceApi().rpc(
        "frontend_seen_file_object",
        {
          p_case: before.case_id,
          p_artifact: artifact,
        },
        { get: false }
      ),
      z.strictObject({
        object_key: key,
        sha256: digest,
        content_sha256: digest,
        size_bytes: z.number().int().positive().max(20000000),
        mime: evidenceMime,
      })
    );
    if (!object.object_key.startsWith(`evidence/${before.case_id}/`))
      throw new Error("Evidence target changed");
    const stored = await getR2ObjectBytes(privateBucket(), object.object_key);
    if (!stored || stored.bytes.length !== object.size_bytes || sha(stored.bytes) !== object.sha256)
      throw new Error("Evidence integrity could not be confirmed");
    const bytes = await decryptData(Buffer.from(stored.bytes));
    if (sha(bytes) !== object.content_sha256 || detectMimeFromMagicBytes(bytes) !== object.mime)
      throw new Error("Evidence content changed");
    const after = await authorize(true);
    if (before.case_id !== after.case_id || before.version !== after.version)
      throw new FoundationStaffCommandError(
        409,
        "The business check changed. Reload before viewing the photo."
      );
    return evidenceViewResponse(bytes);
  });
}

export function sendSeenOwnerMessage(incoming: Request, id: string) {
  return protectBusinessEvidenceRoute(
    incoming,
    "business-verification:message",
    true,
    async (caller, request) => {
      const { api, accountId } = caller;
      const business = z.uuid().parse(id);
      const form = await readBoundedRequestFormData(request, 6 * 1024 * 1024);
      if (
        [...form.keys()].some(
          (field) => !["caseId", "body", "file"].includes(field) || form.getAll(field).length !== 1
        )
      )
        return NextResponse.json({ error: "Check the message details." }, { status: 400 });
      const input = z
        .object({ caseId: z.uuid(), body: z.string().trim().max(2000).optional().default("") })
        .parse(Object.fromEntries(form));
      let attachment: string | undefined;
      const file = form.get("file");
      if (file instanceof File && file.size) {
        const current = (await readMyBusinessChecks(api, business)).cases.find(
          (item) => item.id === input.caseId
        );
        if (!current)
          throw new FoundationStaffCommandError(404, "This business case is unavailable.");
        if (current.kind === "cipc") {
          const { attachNativeCipcReplyFile } = await import("./cipc-document-route");
          attachment = await attachNativeCipcReplyFile(caller, business, current, file);
        } else {
          const data = await readCipcFile(file);
          if (isIntakeError(data))
            return NextResponse.json(
              { error: data.error, code: data.code },
              { status: data.status }
            );
          if (data.activeContent)
            return NextResponse.json(
              { error: "This file contains active content." },
              { status: 422 }
            );
          const bytes = Buffer.from(data.bytes);
          const mime = evidenceMime.parse(detectMimeFromMagicBytes(bytes));
          const reserved = await settleStaffCommand(
            api.rpc(
              "reserve_frontend_seen_reply_file",
              {
                p_business: business,
                p_case: input.caseId,
                p_digest: sha(bytes),
                p_mime: mime,
              },
              { get: false }
            ),
            reservation.refine((r) => r.owner_id === accountId)
          );
          await storeBusinessEvidence(reserved, input.caseId, bytes, "business_reply_attachment");
          attachment = reserved.artifact_id;
        }
      }
      if (!attachment && !input.body)
        return NextResponse.json({ error: "Write a message or attach a file." }, { status: 400 });
      await settleStaffCommand(
        api.rpc(
          "send_frontend_seen_message",
          {
            p_case: input.caseId,
            p_business: business,
            p_body: input.body,
            ...(attachment ? { p_artifact: attachment } : {}),
          },
          { get: false }
        ),
        z.strictObject({ ok: z.literal(true) })
      );
      return NextResponse.json({ ok: true }, { status: 201 });
    }
  );
}
