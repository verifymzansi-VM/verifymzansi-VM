/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

const offload = vi.hoisted(() => ({ readPdf: vi.fn() }));
vi.mock("@/lib/offload/client", async (importOriginal) => ({
  ...(await importOriginal<typeof OffloadClient>()),
  readPdf: offload.readPdf,
}));

import { pdfWithPages } from "@/lib/cipc/pdf-fixtures";
import { OffloadUnavailableError } from "@/lib/offload/client";
import type * as OffloadClient from "@/lib/offload/client";
import { isIntakeError, readCipcFile } from "./intake";

const pdf = () =>
  new File([new Uint8Array(pdfWithPages(["DISCLOSURE CERTIFICATE"]))], "cipc.pdf", {
    type: "application/pdf",
  });

describe("readCipcFile and the PDF reader", () => {
  it("screens the PDF with the reader's result", async () => {
    const { extractPdf } = await import("@/lib/cipc/pdf");
    offload.readPdf.mockImplementation(extractPdf);
    const result = await readCipcFile(pdf(), { pdfOnly: true });
    if (isIntakeError(result)) throw new Error(result.error);
    expect(result.isPdf).toBe(true);
    expect(result.structure?.pageCount).toBe(1);
    expect(result.structure?.hasTextLayer).toBe(true);
  });

  it("asks for the upload again when the PDF reader is unavailable", async () => {
    offload.readPdf.mockRejectedValue(new OffloadUnavailableError("down"));
    expect(await readCipcFile(pdf(), { pdfOnly: true })).toEqual({
      error: "Document checking is busy. Please try again shortly.",
      code: "document_processing_unavailable",
      status: 503,
    });
  });

  it("does not hide other failures", async () => {
    offload.readPdf.mockRejectedValue(new Error("bug"));
    await expect(readCipcFile(pdf(), { pdfOnly: true })).rejects.toThrow("bug");
  });
});
