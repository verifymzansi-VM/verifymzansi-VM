import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { foundationServerPublicApi } from "./server-public";
import {
  MarketplaceQueryError,
  readRestoredCollection,
  type PublicCollection,
} from "./marketplace-read";
import { checkLocalRateLimit, getClientIp } from "../utils/rate-limit";
import { createLogger } from "../utils/logger";

const log = createLogger("PublicMarketplace");
export async function restoredMarketplaceResponse(
  request: NextRequest,
  collection: PublicCollection
) {
  const headers = { "Cache-Control": "private, no-store" };
  const rate = checkLocalRateLimit(getClientIp(request), `${collection}:read`, 120);
  if (rate.limited)
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfter ?? 60) } }
    );
  try {
    const { rows, ...pagination } = await readRestoredCollection(
      foundationServerPublicApi(),
      collection,
      request.nextUrl.searchParams
    );
    return NextResponse.json(
      {
        [collection]: rows,
        ...pagination,
        accountProfiles: [],
        sellers: [],
        businesses: collection === "businesses" ? rows : [],
      },
      { headers }
    );
  } catch (error) {
    if (error instanceof MarketplaceQueryError)
      return NextResponse.json({ error: error.message }, { status: 400, headers });
    log.warn("Public collection unavailable", {
      collection,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Posts could not be loaded. Please try again.", code: "PUBLIC_FEED_UNAVAILABLE" },
      { status: 503, headers }
    );
  }
}
