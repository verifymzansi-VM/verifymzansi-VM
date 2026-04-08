import "server-only";

import crypto from "node:crypto";
import { PLANS, isActiveMarketplaceArea } from "@/lib/constants/pricing";
import { getStablePlanId } from "@/lib/constants/plan-ids";

type StubUser = {
  id: string;
  email: string;
  email_confirmed_at: string;
  password: string;
  persona: string;
  is_anonymous: false;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: Array<{ id: string }>;
};

type StoreTableRow = Record<string, unknown>;

type PlaywrightFixtureStore = {
  sessions: Map<string, string>;
  users: Map<string, StubUser>;
  tables: Map<string, StoreTableRow[]>;
};

const GLOBAL_KEY = "__verifymzansiPlaywrightFixtureStore";
const PLAYWRIGHT_SESSION_PREFIX = "persona:";

const DEFAULT_TABLES = [
  "account_profiles",
  "audit_logs",
  "businesses",
  "entitlements",
  "free_posts_used",
  "listing_views",
  "listings",
  "plans",
  "promotions",
  "r2_cleanup_queue",
];

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function stableUuid(input: string): string {
  const hash = crypto.createHash("sha1").update(input).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(
    16,
    20
  )}-${hash.slice(20, 32)}`;
}

function playwrightUserId(persona: string): string {
  return `pw-${persona}`;
}

function encodeSessionPersona(persona: string): string {
  return `${PLAYWRIGHT_SESSION_PREFIX}${encodeURIComponent(persona)}`;
}

function decodeSessionPersona(token: string | null | undefined): string | null {
  const normalizedToken = token ? decodeURIComponent(token) : null;

  if (!normalizedToken?.startsWith(PLAYWRIGHT_SESSION_PREFIX)) {
    return null;
  }

  try {
    return decodeURIComponent(normalizedToken.slice(PLAYWRIGHT_SESSION_PREFIX.length));
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createEmptyStore(): PlaywrightFixtureStore {
  const tables = new Map<string, StoreTableRow[]>();

  for (const table of DEFAULT_TABLES) {
    tables.set(table, []);
  }

  tables.set(
    "plans",
    PLANS.map((plan) => ({
      id: getStablePlanId(plan.area, plan.tier),
      area: plan.area,
      tier: plan.tier,
      name: plan.name,
      price_cents: plan.priceCents,
      billing_frequency: plan.billingFrequency,
      features: cloneValue(plan.features),
      active: isActiveMarketplaceArea(plan.area),
      created_at: nowIso(),
      updated_at: nowIso(),
    }))
  );

  return {
    sessions: new Map<string, string>(),
    users: new Map<string, StubUser>(),
    tables,
  };
}

function getGlobalStoreContainer(): Record<string, PlaywrightFixtureStore | undefined> {
  return globalThis as unknown as Record<string, PlaywrightFixtureStore | undefined>;
}

export function getPlaywrightFixtureStore(): PlaywrightFixtureStore {
  const container = getGlobalStoreContainer();

  if (!container[GLOBAL_KEY]) {
    container[GLOBAL_KEY] = createEmptyStore();
  }

  return container[GLOBAL_KEY];
}

function ensureTable(store: PlaywrightFixtureStore, table: string): StoreTableRow[] {
  if (!store.tables.has(table)) {
    store.tables.set(table, []);
  }

  return store.tables.get(table)!;
}

function normalizeMarketplaceRow(table: string, row: StoreTableRow): StoreTableRow {
  const nextRow = { ...row };
  const currentTime = nowIso();
  const autoApprove = process.env.PLAYWRIGHT_E2E_AUTO_APPROVE === "1";

  if (table === "listings") {
    nextRow.area ??= "MZANSI_MARKET";
    nextRow.photos ??= [];
    nextRow.videos ??= [];
    nextRow.contact_methods ??= [];
    nextRow.view_count ??= 0;
  }

  if (table === "businesses") {
    nextRow.area ??= "MZANSI_BUSINESS";
    nextRow.gallery_photos ??= [];
    nextRow.services_offered ??= [];
    nextRow.payment_methods_accepted ??= [];
    nextRow.delivery_options ??= [];
  }

  if (table === "promotions") {
    nextRow.area ??= "PROMOTIONS_EVENTS";
    nextRow.photos ??= [];
    nextRow.videos ??= [];
    nextRow.contact_methods ??= [];
    nextRow.view_count ??= 0;
  }

  if (autoApprove && (table === "listings" || table === "businesses" || table === "promotions")) {
    if (nextRow.status === "pending_moderation" || nextRow.status == null) {
      nextRow.status = "live";
      nextRow.published_at ??= currentTime;
    }
  }

  nextRow.updated_at = currentTime;
  nextRow.created_at ??= currentTime;

  return nextRow;
}

function rowBelongsToUser(row: StoreTableRow, userId: string): boolean {
  return (
    row.user_id === userId ||
    row.owner_id === userId ||
    row.seller_id === userId ||
    row.actor_id === userId
  );
}

export function resetPlaywrightFixtureStoreForPersona(persona: string): void {
  const store = getPlaywrightFixtureStore();
  const userId = playwrightUserId(persona);

  for (const [table, rows] of store.tables.entries()) {
    store.tables.set(
      table,
      rows.filter((row) => !rowBelongsToUser(row, userId))
    );
  }

  for (const [token, sessionUserId] of store.sessions.entries()) {
    if (sessionUserId === userId) {
      store.sessions.delete(token);
    }
  }
}

export function ensurePlaywrightVerifiedMember(persona: string): StubUser {
  const store = getPlaywrightFixtureStore();
  const userId = playwrightUserId(persona);
  const email = `${persona}@playwright.verifymzansi.test`;
  const password = `Playwright-${persona}-Password1!`;

  let user = store.users.get(userId);
  if (!user) {
    user = {
      id: userId,
      email,
      email_confirmed_at: nowIso(),
      password,
      persona,
      is_anonymous: false,
      app_metadata: { role: "member" },
      user_metadata: { display_name: `Playwright ${persona}` },
      identities: [{ id: stableUuid(`identity:${persona}`) }],
    };
    store.users.set(userId, user);
  }

  const profiles = ensureTable(store, "account_profiles");
  const existingProfileIndex = profiles.findIndex((row) => row.user_id === userId);
  const profile = {
    id: stableUuid(`profile:${persona}`),
    user_id: userId,
    display_name: `Playwright ${persona}`,
    phone: "+27110000000",
    masked_phone_public: "011 000 0000",
    location_province: "Gauteng",
    location_city: "Johannesburg",
    account_verification_status: "verified",
    account_status: "active",
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  if (existingProfileIndex === -1) {
    profiles.push(profile);
  } else {
    profiles[existingProfileIndex] = { ...profiles[existingProfileIndex], ...profile };
  }

  return user;
}

export function createPlaywrightSession(persona: string): { token: string; user: StubUser } {
  const store = getPlaywrightFixtureStore();
  const user = ensurePlaywrightVerifiedMember(persona);
  const token = encodeSessionPersona(persona);
  store.sessions.set(token, user.id);
  return { token, user };
}

export function resolvePlaywrightSession(token: string | null | undefined): StubUser | null {
  if (!token) return null;

  const persona = decodeSessionPersona(token);
  if (persona) {
    return cloneValue(ensurePlaywrightVerifiedMember(persona));
  }

  const store = getPlaywrightFixtureStore();
  const userId = store.sessions.get(token);
  if (!userId) {
    return null;
  }

  return cloneValue(store.users.get(userId) ?? null);
}

export function listPlaywrightTableRows(table: string): StoreTableRow[] {
  const store = getPlaywrightFixtureStore();
  return cloneValue(ensureTable(store, table));
}

export function writePlaywrightTableRows(table: string, rows: StoreTableRow[]): void {
  const store = getPlaywrightFixtureStore();
  const normalizedRows = rows.map((row) =>
    table === "listings" || table === "businesses" || table === "promotions"
      ? normalizeMarketplaceRow(table, row)
      : { ...row }
  );
  store.tables.set(table, normalizedRows);
}

export function createPlaywrightTableRow(
  table: string,
  row: StoreTableRow,
  options: { preserveId?: boolean } = {}
): StoreTableRow {
  const currentTime = nowIso();
  const nextRow = {
    id:
      options.preserveId && typeof row.id === "string"
        ? row.id
        : stableUuid(`${table}:${currentTime}:${Math.random()}`),
    ...row,
    created_at: row.created_at ?? currentTime,
    updated_at: currentTime,
  };

  if (table === "listings" || table === "businesses" || table === "promotions") {
    return normalizeMarketplaceRow(table, nextRow);
  }

  return nextRow;
}
