import type { SupabaseClient } from "@supabase/supabase-js";
import { getFoundationBrowserClient } from "./browser-client";
import { fetchFoundationAccountSession } from "./account-session-client";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  readFoundationOwnerDashboard,
  presentedDashboardProfile,
  dashboardVerificationSteps,
} from "./owner-dashboard";

type Client = Pick<SupabaseClient, "auth" | "rpc">;
type Resource = "account_profiles" | "verification_steps" | "listings" | "leads" | "notifications";
const resources = new Set<Resource>([
  "account_profiles",
  "verification_steps",
  "listings",
  "leads",
  "notifications",
]);
const pending = new WeakMap<Client, Map<string, ReturnType<typeof load>>>();
async function load(client: Client, owner: string) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || data.user.id !== owner) throw new Error("Profile account changed");
  const [account, snapshot] = await Promise.all([
    fetchFoundationAccountSession(),
    readFoundationOwnerDashboard(client as FoundationAuthenticatedApi, owner),
  ]);
  if (!account || account.account_id !== owner) throw new Error("Profile account changed");
  return { snapshot, profile: presentedDashboardProfile(snapshot, account, data.user) };
}
function read(client: Client, owner: string) {
  let requests = pending.get(client);
  if (!requests) {
    requests = new Map();
    pending.set(client, requests);
  }
  let result = requests.get(owner);
  if (!result) {
    result = load(client, owner);
    requests.set(owner, result);
    const clear = () => {
      if (requests!.get(owner) === result) requests!.delete(owner);
    };
    void result.then(clear, clear);
  }
  return result;
}

/** Presentation reads for existing screens, through a closed self-only RPC.
 * Count projections are deliberately limited to the exact existing sidebar
 * queries. Unsupported filters/full collections fail instead of returning
 * truncated data. No source table access or generic writes are provided. */
export function restoredProfileQuery(client: Client, resource: Resource = "account_profiles") {
  let owner: string | undefined;
  let invalid = false;
  let head = false;
  const filters = new Map<string, unknown>();
  const unavailable = () => ({
    data: null,
    error: { message: "Your account data is unavailable" },
    count: null,
  });
  async function settle(single: boolean) {
    if (invalid || !owner) return unavailable();
    try {
      const value = await read(client, owner);
      if (resource === "account_profiles")
        return { data: single ? value.profile : [value.profile], error: null, count: 1 };
      if (resource === "verification_steps") {
        const rows = dashboardVerificationSteps(value.snapshot).filter((row) => {
          const statuses = filters.get("status");
          const step = filters.get("step_type");
          return (
            (!statuses ||
              (Array.isArray(statuses)
                ? statuses.includes(row.status)
                : statuses === row.status)) &&
            (!step || step === row.step_type)
          );
        });
        if (single) return unavailable();
        return { data: head ? null : rows, error: null, count: rows.length };
      }
      if (!head || single) return unavailable();
      let count: number;
      const status = filters.get("status");
      if (resource === "leads" && status === "new" && filters.size === 1)
        count = value.snapshot.unread_leads;
      else if (resource === "notifications" && filters.get("read") === false && filters.size === 1)
        count = value.snapshot.unread_notifications;
      else if (resource === "listings" && status === "rejected" && filters.size === 1)
        count = value.snapshot.counts.rejected_listings;
      else if (
        resource === "listings" &&
        Array.isArray(status) &&
        status.length > 0 &&
        status.includes("pending_moderation") &&
        status.every((s) => ["pending_moderation", "flagged_for_review"].includes(s)) &&
        filters.size === 1
      )
        count = value.snapshot.counts.pending_listings;
      else return unavailable();
      return { data: null, error: null, count };
    } catch {
      return unavailable();
    }
  }
  const query = {
    select: (_columns?: string, options?: { head?: boolean; count?: string }) => {
      head = options?.head === true;
      return query;
    },
    eq: (column: string, value: unknown) => {
      const ownerColumn =
        column === "user_id" ||
        column === "owner_id" ||
        (column === "id" && resource === "account_profiles");
      if (ownerColumn) {
        if (typeof value !== "string" || (owner !== undefined && owner !== value)) invalid = true;
        else owner = value;
      } else if (
        (column === "status" && resource !== "account_profiles") ||
        (column === "read" && resource === "notifications") ||
        (column === "step_type" && resource === "verification_steps")
      ) {
        if (filters.has(column) && filters.get(column) !== value) invalid = true;
        filters.set(column, value);
      } else invalid = true;
      return query;
    },
    in: (column: string, values: unknown[]) => {
      if (
        column !== "status" ||
        resource === "account_profiles" ||
        filters.has(column) ||
        !Array.isArray(values)
      )
        invalid = true;
      else filters.set(column, values);
      return query;
    },
    update: () => {
      invalid = true;
      return query;
    },
    insert: () => {
      invalid = true;
      return query;
    },
    upsert: () => {
      invalid = true;
      return query;
    },
    delete: () => {
      invalid = true;
      return query;
    },
    single: () => settle(true),
    maybeSingle: () => settle(true),
    then: <TResult1 = Awaited<ReturnType<typeof settle>>, TResult2 = never>(
      fulfilled?:
        ((value: Awaited<ReturnType<typeof settle>>) => TResult1 | PromiseLike<TResult1>) | null,
      rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) => settle(false).then(fulfilled, rejected),
  };
  return query;
}
const facades = new WeakMap<object, SupabaseClient>();
export function getRestoredFoundationBrowserClient(): SupabaseClient {
  const native = getFoundationBrowserClient();
  const cached = facades.get(native);
  if (cached) return cached;
  const facade = new Proxy(native as unknown as SupabaseClient, {
    get(target, property) {
      if (property === "from")
        return (table: string) =>
          resources.has(table as Resource)
            ? restoredProfileQuery(target, table as Resource)
            : target.from(table);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  facades.set(native, facade);
  return facade;
}
