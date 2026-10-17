import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

// Keep the exact Postgres timestamp string: converting through Date discards
// microseconds and can skip/repeat history rows at a keyset boundary.
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/)
  .pipe(z.iso.datetime({ offset: true }));
const generation = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .pipe(z.string().refine((value) => BigInt(value) <= BigInt("9223372036854775807")));
const version = z.number().int().min(1).max(2147483647);
const cursor = z.strictObject({ before_time: instant, before_id: z.uuid() });
const historyRequest = z.strictObject({ owner_id: z.uuid(), cursor: cursor.optional() });
const identity = z.strictObject({
  identity_fact_id: z.uuid(),
  submission_id: z.uuid(),
  reviewed_at: instant,
  identity_is_current: z.boolean(),
});
const history = z
  .strictObject({
    case_id: z.uuid(),
    case_version: version,
    claim_generation: generation,
    claim_nonce: z.uuid(),
    claim_expires_at: instant,
    identities: z.array(identity).max(20),
    next_cursor: cursor.nullable(),
  })
  .refine(
    (value) =>
      new Set(value.identities.map((row) => row.identity_fact_id)).size === value.identities.length
  )
  .refine(
    (value) =>
      value.next_cursor === null ||
      (value.identities.length === 20 &&
        value.next_cursor.before_id === value.identities[19].identity_fact_id &&
        value.next_cursor.before_time === value.identities[19].reviewed_at)
  );
const contextRequest = z.strictObject({
  case_id: z.uuid(),
  claim_generation: generation,
  claim_nonce: z.uuid(),
});
const context = z
  .strictObject({
    case_id: z.uuid(),
    case_version: version,
    submission_id: z.uuid(),
    risk_score: z.number().int().min(0).max(100),
    recipe: z.literal("manual-id-selfie-v1"),
    id_artifact_id: z.uuid(),
    selfie_artifact_id: z.uuid(),
  })
  .refine((value) => value.id_artifact_id !== value.selfie_artifact_id);
export type FoundationStaffIdentityHistory = z.infer<typeof history>;
export type FoundationStaffIdentityContext = z.infer<typeof context>;

export function buildStaffIdentityHistoryCommand(input: unknown) {
  const parsed = historyRequest.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation identity history request");
  return parsed.data.cursor
    ? {
        p_owner: parsed.data.owner_id,
        p_before_time: parsed.data.cursor.before_time,
        p_before_id: parsed.data.cursor.before_id,
      }
    : { p_owner: parsed.data.owner_id };
}
export function parseStaffIdentityHistory(input: unknown): FoundationStaffIdentityHistory {
  const parsed = history.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation identity history");
  return parsed.data;
}
export function buildStaffIdentityContextCommand(input: unknown) {
  const parsed = contextRequest.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation identity review request");
  return {
    p_case: parsed.data.case_id,
    p_claim_generation: parsed.data.claim_generation,
    p_claim_nonce: parsed.data.claim_nonce,
  };
}
export function parseStaffIdentityContext(input: unknown): FoundationStaffIdentityContext {
  const parsed = context.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation identity review context");
  return parsed.data;
}

/** This POST creates/reclaims context and audits access. Never prefetch, GET,
 * silently retry or auto-page it. identity_is_current is only identity readiness,
 * not a public verified-account badge. Metadata grants no document/number access.
 */
export async function readStaffIdentityHistory(api: FoundationAuthenticatedApi, input: unknown) {
  const { data, error } = await api.rpc(
    "staff_identity_history",
    buildStaffIdentityHistoryCommand(input),
    { get: false }
  );
  if (error) throw new Error("Foundation identity history unavailable");
  return parseStaffIdentityHistory(data);
}
export async function readStaffIdentityContext(api: FoundationAuthenticatedApi, input: unknown) {
  const command = buildStaffIdentityContextCommand(input);
  const { data, error } = await api.rpc("staff_identity_review_context", command, { get: false });
  if (error) throw new Error("Foundation identity review unavailable");
  const result = parseStaffIdentityContext(data);
  if (result.case_id !== command.p_case)
    throw new Error("Invalid foundation identity review context");
  return result;
}
