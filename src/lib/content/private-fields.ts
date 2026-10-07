import "server-only";

import { readCustomerAccess } from "@/lib/forms/customer-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";

/**
 * Columns anon and signed-in users cannot read through the database API
 * (20261007130000_private_contact_columns.sql). Server code reads them with the
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

/** The private columns of the given businesses, by id (service role). */
export async function loadBusinessPrivateFields(
  ids: string[]
): Promise<Map<string, BusinessPrivateFields>> {
  const out = new Map<string, BusinessPrivateFields>();
  if (!ids.length) return out;
  try {
    const { data, error } = await createAdminClient()
      .from("businesses")
      .select("id, phone, whatsapp, email, location_address, map_directions")
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as unknown as Array<BusinessPrivateFields & { id: string }>) {
      const { id, ...fields } = row;
      out.set(id, fields);
    }
  } catch (error) {
    // Without them the page shows no address or "Show number"; never crash.
    log.error("Could not read business private fields", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return out;
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
 * Adds the private fields a viewer may see to business rows: everything for
 * the owner; the street address and map pin for everyone when the business
 * publishes them; contact details never (they come from the reveal endpoint).
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
    // Which contact methods exist, so the page can offer "Show number".
    const contact_available = {
      phone: Boolean(f.phone),
      whatsapp: Boolean(f.whatsapp),
      email: Boolean(f.email),
    };
    if (viewerId && row.owner_id === viewerId) return { ...row, ...f, contact_available };
    return businessAddressIsPublic(row)
      ? {
          ...row,
          location_address: f.location_address,
          map_directions: f.map_directions,
          contact_available,
        }
      : { ...row, contact_available };
  });
}

export type ContactAvailability = { phone: boolean; whatsapp: boolean; email: boolean };
