import { type NextRequest } from "next/server";
import { POST as postBusinessBoost } from "@/app/api/businesses/[id]/boost/route";

/**
 * Legacy compatibility route.
 *
 * Historical business-ad profile IDs were migrated into the unified
 * `businesses` table while preserving UUIDs. Forward old boost requests to the
 * current business checkout handler.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return postBusinessBoost(request, context);
}
