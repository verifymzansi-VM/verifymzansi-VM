import "server-only";

import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { createLogger } from "@/lib/utils/logger";

/**
 * One structured warning when a retired ("source") Supabase client is created
 * (roadmap M0.11). In production the
 * retired clients reach an empty schema, so this shows which routes still run
 * old-backend code instead of letting them fail silently.
 *
 * The entry carries only the Next.js route pattern (for example
 * "/api/organisations/[id]/report", never a concrete URL, query string or ID)
 * and which factory was used. It never throws and never changes the caller's
 * behaviour. Each route is logged at most once per window per server instance.
 */
export const LEGACY_CLIENT_EVENT = "legacy_client_in_foundation";

export type LegacyClientKind = "admin" | "server" | "public";

const logger = createLogger("LegacyBackend");
const REPEAT_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_ROUTES = 200;
const MAX_ROUTE_LENGTH = 160;
// Route patterns use path segments, [param], [...param], (group) and @slot.
const SAFE_ROUTE = /^\/[A-Za-z0-9/_\-.[\]()@]*$/;
const lastLoggedAt = new Map<string, number>();

function currentRoute(): string {
  const route = workAsyncStorage.getStore()?.route;
  if (typeof route !== "string" || route.length > MAX_ROUTE_LENGTH || !SAFE_ROUTE.test(route)) {
    return "unknown";
  }
  return route;
}

function shouldLog(route: string, now: number): boolean {
  const last = lastLoggedAt.get(route);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return false;
  lastLoggedAt.delete(route);
  if (lastLoggedAt.size >= MAX_TRACKED_ROUTES) {
    const oldest = lastLoggedAt.keys().next().value;
    if (oldest !== undefined) lastLoggedAt.delete(oldest);
  }
  lastLoggedAt.set(route, now);
  return true;
}

export function noteLegacyClientCreated(client: LegacyClientKind): void {
  try {
    const route = currentRoute();
    if (!shouldLog(route, Date.now())) return;
    logger.warn(LEGACY_CLIENT_EVENT, { route, client });
  } catch {
    // Observability only: never affect the request that created the client.
  }
}
