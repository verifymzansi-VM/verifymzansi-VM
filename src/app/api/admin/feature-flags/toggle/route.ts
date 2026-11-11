/**
 * POST /api/admin/feature-flags/toggle
 * Update a feature flag configuration. Admin-only.
 *
 * Accepts two payload formats:
 * - Legacy:  { key, enabled }          → maps to mode "on"/"off"
 * - Canary:  { key, mode, percent?, allowlist_roles?, reason }
 */

import { type NextRequest } from "next/server";
import { handleRestoredFeatureFlag } from "@/lib/foundation/restored-feature-flag-route";

export async function POST(request: NextRequest) {
  return handleRestoredFeatureFlag(request);
}
