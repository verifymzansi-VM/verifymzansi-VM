import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { settleStaffCommand } from "./staff-command";
const config = z.strictObject({
  key: z.literal("kyc_evidence_desk"),
  enabled: z.boolean(),
  mode: z.enum(["off", "on", "percent", "allowlist"]),
  rollout_percent: z.number().int().min(0).max(100),
  allowlist_roles: z
    .array(z.enum(["admin", "moderator", "governance_controller", "member", "buyer"]))
    .max(5),
});
export const frontendFeatureFlagSchema = config
  .extend({
    id: z.uuid(),
    description: z.string().max(500),
    revision: z.number().int().min(1).max(2147483647),
    updated_at: z.iso.datetime({ offset: true }),
    updated_reason: z.string().max(500).nullable(),
  })
  .refine((f) => f.enabled === (f.mode !== "off"));
const flagsResponse = z.strictObject({
  account_id: z.uuid(),
  flags: z.array(frontendFeatureFlagSchema).max(1),
});
export type FrontendFeatureFlag = z.infer<typeof frontendFeatureFlagSchema>;
export function parseFrontendFlagAcknowledgement(
  body: unknown,
  key: string,
  expectedRevision: number | undefined
) {
  return z
    .object({ success: z.literal(true), flag: frontendFeatureFlagSchema })
    .refine(
      (v) =>
        v.flag.key === key &&
        expectedRevision !== undefined &&
        v.flag.revision === expectedRevision + 1
    )
    .parse(body).flag;
}
export async function readFrontendFeatureFlags(api: FoundationAuthenticatedApi, callerId: string) {
  const response = await settleStaffCommand(
    api.rpc("get_frontend_feature_flags", {}, { get: false }),
    flagsResponse.refine((v) => v.account_id === callerId)
  );
  return response.flags;
}
export async function readFrontendFeatureConfig(api: FoundationServiceApi) {
  const response = await api.rpc("read_frontend_feature_config", {}, { get: false });
  if (response.error) throw new Error("Feature configuration unavailable");
  return z
    .array(config.refine((f) => f.enabled === (f.mode !== "off")))
    .max(1)
    .parse(response.data);
}
export const featureFlagInput = z
  .strictObject({
    key: z.literal("kyc_evidence_desk"),
    expectedRevision: z.number().int().min(1).max(2147483646),
    enabled: z.boolean().optional(),
    mode: z.enum(["off", "on", "percent", "allowlist"]).optional(),
    percent: z.number().int().min(0).max(100).optional(),
    allowlist_roles: z
      .array(z.enum(["admin", "moderator", "governance_controller", "member", "buyer"]))
      .max(5)
      .optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => Boolean(v.mode) !== (v.enabled !== undefined))
  .refine((v) => !v.mode || Boolean(v.reason))
  .refine((v) => v.mode !== "percent" || v.percent !== undefined);
export async function setFrontendFeatureFlag(api: FoundationAuthenticatedApi, body: unknown) {
  const input = featureFlagInput.parse(body);
  const mode = input.mode ?? (input.enabled ? "on" : "off");
  const percent = mode === "percent" ? input.percent! : mode === "on" ? 100 : 0;
  const roles = mode === "allowlist" ? [...new Set(input.allowlist_roles ?? [])].sort() : [];
  const reason = input.reason ?? `Quick toggle: ${mode}`;
  const response = await settleStaffCommand(
    api.rpc(
      "set_frontend_feature_flag",
      {
        p_key: input.key,
        p_expected_revision: input.expectedRevision,
        p_mode: mode,
        p_percent: percent,
        p_roles: roles,
        p_reason: reason,
      },
      { get: false }
    ),
    flagsResponse.refine(
      (v) =>
        v.flags.length === 1 &&
        v.flags[0].revision === input.expectedRevision + 1 &&
        v.flags[0].key === input.key &&
        v.flags[0].mode === mode &&
        v.flags[0].rollout_percent === percent &&
        v.flags[0].updated_reason === reason &&
        v.flags[0].allowlist_roles.join(",") === roles.join(",")
    )
  );
  return response.flags[0];
}
const number = z.number().int().nonnegative();
export async function readFrontendGovernanceMetrics(
  api: FoundationAuthenticatedApi,
  callerId: string
) {
  return settleStaffCommand(
    api.rpc("get_frontend_governance_metrics", {}, { get: false }),
    z
      .strictObject({
        account_id: z.literal(callerId),
        total: number,
        approved: number,
        rejected: number,
        overridden: number,
      })
      .refine((v) => v.approved + v.rejected <= v.total && v.overridden <= v.approved)
  );
}
