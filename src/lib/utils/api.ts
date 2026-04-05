import { NextResponse } from "next/server";
import type { output, ZodTypeAny } from "zod";
import { toFieldErrorMap } from "@/lib/validations/zod-errors";
import type { Logger } from "@/lib/utils/logger";

type JsonRequestLike =
  | Pick<Request, "text">
  | {
      json: () => Promise<unknown>;
    };

interface ParseValidatedJsonOptions {
  invalidJsonMessage?: string;
  validationErrorMessage?: string;
  validationStatus?: number;
  includeValidationDetails?: boolean;
}

type KeyValueEntrySource = Pick<FormData, "entries"> | Pick<URLSearchParams, "entries">;

function buildValidationErrorResponse(
  schemaError: Parameters<typeof toFieldErrorMap>[0],
  options: ParseValidatedJsonOptions
): NextResponse {
  const payload: Record<string, unknown> = {
    error: options.validationErrorMessage ?? "Validation failed",
  };

  if (options.includeValidationDetails ?? true) {
    payload.details = toFieldErrorMap(schemaError);
  }

  return NextResponse.json(payload, { status: options.validationStatus ?? 400 });
}

function coerceEntriesToObject(source: KeyValueEntrySource): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const [key, value] of source.entries()) {
    const existing = data[key];
    if (existing === undefined) {
      data[key] = value;
      continue;
    }

    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }

    data[key] = [existing, value];
  }

  return data;
}

/**
 * Safely parse a JSON request body, returning null if invalid
 * to prevent uncaught 500 errors on the server.
 *
 * @param maxBytes Maximum text length to accept (default 256 KiB). Returns null for oversized bodies.
 */
export async function parseJsonRequest<T = Record<string, unknown>>(
  request: JsonRequestLike,
  { maxBytes = 256 * 1024 }: { maxBytes?: number } = {}
): Promise<T | null> {
  try {
    if ("text" in request && typeof request.text === "function") {
      const text = await request.text();
      if (!text) return null;
      if (text.length > maxBytes) return null;
      return JSON.parse(text) as T;
    }

    if ("json" in request && typeof request.json === "function") {
      return (await request.json()) as T;
    }

    return null;
  } catch {
    return null;
  }
}

export async function parseAndValidateJsonRequest<TSchema extends ZodTypeAny>(
  request: JsonRequestLike,
  schema: TSchema,
  options: ParseValidatedJsonOptions = {}
): Promise<
  | {
      success: true;
      data: output<TSchema>;
    }
  | {
      success: false;
      response: NextResponse;
    }
> {
  const body = await parseJsonRequest(request);

  if (body === null) {
    return {
      success: false,
      response: NextResponse.json(
        { error: options.invalidJsonMessage ?? "Invalid JSON payload" },
        { status: 400 }
      ),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      success: false,
      response: buildValidationErrorResponse(parsed.error, options),
    };
  }

  return { success: true, data: parsed.data };
}

export function parseAndValidateSearchParams<TSchema extends ZodTypeAny>(
  searchParams: Pick<URLSearchParams, "entries">,
  schema: TSchema,
  options: ParseValidatedJsonOptions = {}
):
  | {
      success: true;
      data: output<TSchema>;
    }
  | {
      success: false;
      response: NextResponse;
    } {
  const parsed = schema.safeParse(coerceEntriesToObject(searchParams));
  if (!parsed.success) {
    return {
      success: false,
      response: buildValidationErrorResponse(parsed.error, options),
    };
  }

  return { success: true, data: parsed.data };
}

export function parseAndValidateFormData<TSchema extends ZodTypeAny>(
  formData: Pick<FormData, "entries">,
  schema: TSchema,
  options: ParseValidatedJsonOptions = {}
):
  | {
      success: true;
      data: output<TSchema>;
    }
  | {
      success: false;
      response: NextResponse;
    } {
  const parsed = schema.safeParse(coerceEntriesToObject(formData));
  if (!parsed.success) {
    return {
      success: false,
      response: buildValidationErrorResponse(parsed.error, options),
    };
  }

  return { success: true, data: parsed.data };
}

export function parseAndValidateRouteParams<TSchema extends ZodTypeAny>(
  params: unknown,
  schema: TSchema,
  options: ParseValidatedJsonOptions = {}
):
  | {
      success: true;
      data: output<TSchema>;
    }
  | {
      success: false;
      response: NextResponse;
    } {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return {
      success: false,
      response: buildValidationErrorResponse(parsed.error, options),
    };
  }

  return { success: true, data: parsed.data };
}

export function logApiError(
  log: Pick<Logger, "error">,
  message: string,
  error: unknown,
  meta: Record<string, unknown> = {}
): void {
  log.error(message, {
    ...meta,
    error: error instanceof Error ? error.message : "Unknown error",
  });
}

export function internalApiError(message = "Internal server error", status = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

// ── Standardized error response helpers ──────────────────────────────

export function unauthorizedResponse(message = "Unauthorized"): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbiddenResponse(message = "Forbidden", reason?: string): NextResponse {
  const body: Record<string, string> = { error: message };
  if (reason) body.reason = reason;
  return NextResponse.json(body, { status: 403 });
}

export function notFoundResponse(message = "Not found"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function badRequestResponse(message = "Bad request", details?: string): NextResponse {
  const body: Record<string, string> = { error: message };
  if (details) body.details = details;
  return NextResponse.json(body, { status: 400 });
}

export function rateLimitResponse(retryAfter?: number): NextResponse {
  const body: Record<string, unknown> = {
    error: "Too many requests. Please try again later.",
  };
  if (retryAfter != null) body.retryAfter = retryAfter;
  const headers: HeadersInit = {};
  if (retryAfter != null) headers["Retry-After"] = String(retryAfter);
  return NextResponse.json(body, { status: 429, headers });
}
