import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const request = z.strictObject({});
const observation = z
  .strictObject({
    verification_ready: z.boolean(),
    phone_verified: z.boolean(),
    locality_confirmed: z.boolean(),
  })
  .refine(
    (value) => !value.verification_ready || (value.phone_verified && value.locality_confirmed)
  );

export type FoundationVerificationReadiness = z.infer<typeof observation>;

export type FoundationVerificationReadinessFailure =
  "invalid_request" | "request_failed" | "rpc_error" | "malformed";

/** Only a short Postgres/PostgREST error code (for example 42501 or PGRST301)
 * is kept; database messages and details may name the caller and are dropped. */
const ERROR_CODE = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/;

/** Failure with a non-identifying category, safe to log. */
export class FoundationVerificationReadinessError extends Error {
  override name = "FoundationVerificationReadinessError";
  constructor(
    message: string,
    readonly reason: FoundationVerificationReadinessFailure,
    readonly code: string | null = null
  ) {
    super(message);
  }
}

/** Current caller's observation only. Submit and approval recheck canonical facts.
 * No actor selection, identity/evidence details, cached permission or retries. */
export async function readFoundationVerificationReadiness(
  api: FoundationAuthenticatedApi,
  input: unknown = {}
): Promise<FoundationVerificationReadiness> {
  if (!request.safeParse(input).success)
    throw new FoundationVerificationReadinessError(
      "Invalid foundation verification readiness request",
      "invalid_request"
    );
  const { data, error } = await api.rpc("get_owner_verification_readiness", {}).then(
    (value) => value,
    () => {
      throw new FoundationVerificationReadinessError(
        "Foundation verification readiness unavailable",
        "request_failed"
      );
    }
  );
  if (error) {
    const code = typeof error.code === "string" && ERROR_CODE.test(error.code) ? error.code : null;
    throw new FoundationVerificationReadinessError(
      "Foundation verification readiness unavailable",
      "rpc_error",
      code
    );
  }
  const parsed = observation.safeParse(data);
  if (!parsed.success)
    throw new FoundationVerificationReadinessError(
      "Invalid foundation verification readiness response",
      "malformed"
    );
  return parsed.data;
}
