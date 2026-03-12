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

/**
 * Safely parse a JSON request body, returning null if invalid
 * to prevent uncaught 500 errors on the server.
 */
export async function parseJsonRequest<T = Record<string, unknown>>(
  request: JsonRequestLike
): Promise<T | null> {
  try {
    if ("text" in request && typeof request.text === "function") {
      const text = await request.text();
      if (!text) return null;
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
    const payload: Record<string, unknown> = {
      error: options.validationErrorMessage ?? "Validation failed",
    };

    if (options.includeValidationDetails ?? true) {
      payload.details = toFieldErrorMap(parsed.error);
    }

    return {
      success: false,
      response: NextResponse.json(payload, { status: options.validationStatus ?? 400 }),
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
