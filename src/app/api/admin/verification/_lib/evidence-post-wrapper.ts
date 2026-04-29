import { NextRequest, NextResponse } from "next/server";
import { type z } from "zod";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import type { AppLogger } from "@/lib/utils/logger";

export async function forwardEvidencePostBodyToGet<TBody>({
  request,
  schema,
  logger,
  invalidJsonMessage,
  validationErrorMessage,
  toSearchParams,
  get,
}: {
  request: NextRequest;
  schema: z.ZodType<TBody>;
  logger: AppLogger;
  invalidJsonMessage: string;
  validationErrorMessage: string;
  toSearchParams: (body: TBody, searchParams: URLSearchParams) => void;
  get: (request: NextRequest) => Promise<NextResponse>;
}) {
  try {
    const mutationBlock = enforceMutationRequest(request, logger);
    if (mutationBlock) return mutationBlock;

    const parsedBody = await parseAndValidateJsonRequest(request, schema, {
      invalidJsonMessage,
      validationErrorMessage,
      includeValidationDetails: false,
    });
    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const url = new URL(request.url);
    toSearchParams(parsedBody.data, url.searchParams);
    const syntheticRequest = new NextRequest(url, {
      method: "GET",
      headers: request.headers,
    });

    return get(syntheticRequest);
  } catch (err) {
    logger.error("POST wrapper error", {
      error: err instanceof Error ? err.message : "unknown error",
    });
    return NextResponse.json(
      { error: "Internal server error", code: "server_error" },
      { status: 500 }
    );
  }
}
