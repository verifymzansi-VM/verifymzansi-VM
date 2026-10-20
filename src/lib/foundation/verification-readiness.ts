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

/** Current caller's observation only. Submit and approval recheck canonical facts.
 * No actor selection, identity/evidence details, cached permission or retries. */
export async function readFoundationVerificationReadiness(
  api: FoundationAuthenticatedApi,
  input: unknown = {}
): Promise<FoundationVerificationReadiness> {
  if (!request.safeParse(input).success)
    throw new Error("Invalid foundation verification readiness request");
  const { data, error } = await api.rpc("get_owner_verification_readiness", {}).then(
    (value) => value,
    () => {
      throw new Error("Foundation verification readiness unavailable");
    }
  );
  if (error) throw new Error("Foundation verification readiness unavailable");
  const parsed = observation.safeParse(data);
  if (!parsed.success) throw new Error("Invalid foundation verification readiness response");
  return parsed.data;
}
