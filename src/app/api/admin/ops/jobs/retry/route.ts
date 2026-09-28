import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { decisionRefusalResponse } from "@/lib/services/decision-ledger";

const log = createLogger("OpsJobRetry");
const schema = z.object({ jobId: z.string().uuid() });

/**
 * POST /api/admin/ops/jobs/retry — an admin puts a dead job back in the queue.
 * Jobs are idempotent, so a retry never repeats completed work.
 */
export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      adminOnly: true,
      rateLimitAction: "admin:ops:retry",
    });
    if (!guard.success) return guard.response;

    const body = await parseAndValidateJsonRequest(request, schema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;

    const { data, error } = await createAdminClient().rpc("retry_operation_job", {
      p_actor: guard.user.id,
      p_job: body.data.jobId,
    });
    if (error) throw new Error(error.message);
    const result = data as { ok: boolean; error?: string };
    if (!result.ok) {
      return result.error === "not_dead"
        ? NextResponse.json(
            { error: "Only jobs that stopped retrying can be retried." },
            { status: 409 }
          )
        : decisionRefusalResponse(result.error ?? "forbidden");
    }
    return NextResponse.json({ status: "pending" });
  } catch (err) {
    logApiError(log, "Retry failed", err);
    return internalApiError();
  }
}
