import "server-only";

import { readCustomerAccess } from "@/lib/forms/customer-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";

/**
 * Business contact details and street addresses live in server-only tables
 * (business_private, listing_private; 20261007121453_private_post_tables.sql),
 * never on the rows the public can read. Server code reads them with the
 * service role after its own checks: contact details go out only through the
 * tap-to-reveal endpoint or to the owner; a street address only when public.
 */
const BUSINESS_PRIVATE_COLUMNS = [
  "phone",
  "whatsapp",
  "email",
  "location_address",
  "map_directions",
] as const;

export type BusinessPrivateFields = {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  location_address: string | null;
  map_directions: string | null;
};

const log = createLogger("ContentPrivateFields");

/** Reads business_private for the given ids (service role); throws on failure. */
async function queryBusinessPrivate(ids: string[]): Promise<Map<string, BusinessPrivateFields>> {
  const out = new Map<string, BusinessPrivateFields>();
  if (!ids.length) return out;
  const { data, error } = await createAdminClient()
    .from("business_private")
    .select("business_id, phone, whatsapp, email, location_address, map_directions")
    .in("business_id", ids);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as unknown as Array<
    BusinessPrivateFields & { business_id: string }
  >) {
    const { business_id, ...fields } = row;
    out.set(business_id, fields);
  }
  return out;
}

/** The private fields of the given businesses, by id; empty when unreadable. */
export async function loadBusinessPrivateFields(
  ids: string[]
): Promise<Map<string, BusinessPrivateFields>> {
  try {
    return await queryBusinessPrivate(ids);
  } catch (error) {
    // Without them the page shows no address or "Show number"; never crash.
    log.error("Could not read business private fields", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

/** The private street address of the given listings, by id (service role). */
async function loadListingAddresses(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!ids.length) return out;
  const { data, error } = await createAdminClient()
    .from("listing_private")
    .select("listing_id, location_address")
    .in("listing_id", ids);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as Array<{ listing_id: string; location_address: string | null }>)
    out.set(row.listing_id, row.location_address);
  return out;
}

/**
 * Staff and owner views (moderation, edit review, data exports): the rows with
 * every private field filled in from the private tables. Throws on failure so
 * a decision is never made against missing contact details.
 */
export async function withAllPrivateFields<T extends { id: string }>(
  table: "businesses",
  rows: T[]
): Promise<Array<T & BusinessPrivateFields>>;
export async function withAllPrivateFields<T extends { id: string }>(
  table: "listings",
  rows: T[]
): Promise<Array<T & { location_address: string | null }>>;
export async function withAllPrivateFields<T extends { id: string }>(
  table: "businesses" | "listings",
  rows: T[]
): Promise<Array<T & Partial<BusinessPrivateFields>>>;
export async function withAllPrivateFields<T extends { id: string }>(
  table: "businesses" | "listings",
  rows: T[]
): Promise<Array<T & Partial<BusinessPrivateFields>>> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  if (table === "listings") {
    const addresses = await loadListingAddresses(ids);
    return rows.map((row) => ({ ...row, location_address: addresses.get(row.id) ?? null }));
  }
  const byId = await queryBusinessPrivate(ids);
  const empty: BusinessPrivateFields = {
    phone: null,
    whatsapp: null,
    email: null,
    location_address: null,
    map_directions: null,
  };
  return rows.map((row) => ({ ...row, ...(byId.get(row.id) ?? empty) }));
}

/** Whether a business has chosen to show its street address and map pin. */
function businessAddressIsPublic(business: {
  business_type?: string | null;
  category_details?: unknown;
}): boolean {
  if (business.business_type === "home_business") return false;
  const access = (business.category_details as { customer_access?: unknown } | null)
    ?.customer_access;
  // Profiles saved before customer access existed published their address.
  return access ? readCustomerAccess(access).publishAddress : true;
}

/**
 * Adds the private fields a viewer may see to business rows, one page at a
 * time (the tables are never readable in bulk): the business's chosen contact
 * details for everyone, no sign-in needed; the street address and map pin when
 * the business publishes them; everything for the owner. Private sellers'
 * numbers are not here: listings and events use the "Show number" button
 * (/api/contact/reveal).
 */
export async function withVisibleBusinessPrivateFields<
  T extends {
    id: string;
    owner_id?: string | null;
    business_type?: string | null;
    category_details?: unknown;
  },
>(
  rows: T[],
  viewerId: string | null
): Promise<
  Array<T & Partial<BusinessPrivateFields> & { contact_available?: ContactAvailability }>
> {
  const fields = await loadBusinessPrivateFields(rows.map((r) => r.id));
  return rows.map((fullRow) => {
    // Never pass on private values that arrived with the row itself.
    const row = { ...fullRow };
    for (const column of BUSINESS_PRIVATE_COLUMNS) delete (row as Record<string, unknown>)[column];
    const f = fields.get(fullRow.id);
    if (!f) return row;
    // Which contact methods exist (contact buttons and the sticky bar).
    const contact_available = {
      phone: Boolean(f.phone),
      whatsapp: Boolean(f.whatsapp),
      email: Boolean(f.email),
    };
    if (viewerId && row.owner_id === viewerId) return { ...row, ...f, contact_available };
    const contact = { phone: f.phone, whatsapp: f.whatsapp, email: f.email };
    return businessAddressIsPublic(row)
      ? {
          ...row,
          ...contact,
          location_address: f.location_address,
          map_directions: f.map_directions,
          contact_available,
        }
      : { ...row, ...contact, contact_available };
  });
}

export type ContactAvailability = { phone: boolean; whatsapp: boolean; email: boolean };
