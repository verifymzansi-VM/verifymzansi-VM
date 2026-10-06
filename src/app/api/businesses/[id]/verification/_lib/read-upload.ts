import { NextResponse, type NextRequest } from "next/server";

import { readBoundedRequestFormData, RequestBodyTooLargeError } from "@/lib/utils/request-body";

const MAX_BODY_BYTES = 6 * 1024 * 1024;

/** Multipart body capped at 6 MB (a 5 MB file plus fields). */
export async function readVerificationForm(request: NextRequest): Promise<FormData | NextResponse> {
  try {
    return await readBoundedRequestFormData(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Files can be up to 5 MB." }, { status: 413 });
    }
    return NextResponse.json({ error: "Send the form as multipart/form-data." }, { status: 400 });
  }
}

export function formText(form: FormData, key: string, max = 200): string | null {
  const value = form.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function formFile(form: FormData, key: string): File | null {
  const value = form.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}
