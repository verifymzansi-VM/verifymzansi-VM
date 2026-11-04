import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { readFoundationServerSession } from "./server-session";
import { createFoundationServiceApi } from "./service-api";
import {
  readFrontendFeatureConfig,
  readFrontendFeatureFlags,
  readFrontendGovernanceMetrics,
} from "./feature-controls";
import { FoundationStaffCommandError } from "./staff-command";
import { staffVerifyHref } from "../auth/staff-mfa-links";
export const readNativeDisplayFlags = cache(async () =>
  readFrontendFeatureConfig(createFoundationServiceApi())
);
export async function readNativeAdminFlags() {
  const current = await readFoundationServerSession();
  try {
    return await readFrontendFeatureFlags(current.api, current.user.id);
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(staffVerifyHref("/staff/two-step?confirm=1", "/admin/feature-flags"));
    throw error;
  }
}
export async function readNativeGovernanceMetrics() {
  const current = await readFoundationServerSession();
  try {
    return await readFrontendGovernanceMetrics(current.api, current.user.id);
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(staffVerifyHref("/staff/two-step?confirm=1", "/admin/governance/oversight"));
    throw error;
  }
}
