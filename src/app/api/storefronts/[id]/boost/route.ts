import { type NextRequest } from "next/server";
import { POST as postBusinessBoost } from "@/app/api/businesses/[id]/boost/route";

/**
 * Legacy compatibility route.
 *
 * Storefront IDs were migrated into the unified `businesses` table while keeping
 * the original UUIDs. Forward old boost requests to the unified business route.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return postBusinessBoost(request, context);
}
