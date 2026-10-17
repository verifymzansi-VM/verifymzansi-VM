import { z } from "zod";
import type { FoundationPublicApi } from "./public-api";

const addonKind = z.enum(["boost", "featured", "urgent"]);
const cents = (maximum: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]{2,8}$/)
    .pipe(
      z
        .string()
        .refine(
          (value) => Number(value) >= 100 && Number(value) <= maximum,
          "Price outside catalogue bounds"
        )
    );
const plan = z.strictObject({
  id: z.uuid(),
  code: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
  label: z.string().min(1).max(120),
  area: z.enum(["market", "business", "tourism_events"]).nullable(),
  price_cents: cents(100000000),
  currency: z.literal("ZAR"),
  duration_days: z.number().int().min(1).max(366),
  slot_capacity: z.number().int().min(1).max(1000),
  max_photos: z.number().int().min(1).max(50),
  max_videos: z.number().int().min(0).max(10),
  addon_capabilities: z
    .array(addonKind)
    .max(3)
    .refine((values) => new Set(values).size === values.length),
});
const addon = z.strictObject({
  id: z.uuid(),
  kind: addonKind,
  days: z.number().int().min(1).max(90),
  price_cents: cents(10000000),
  currency: z.literal("ZAR"),
});
const catalogue = z
  .strictObject({ plans: z.array(plan).max(1000), addons: z.array(addon).max(1000) })
  .refine((value) => {
    const ids = [...value.plans, ...value.addons].map((row) => row.id);
    return new Set(ids).size === ids.length;
  }, "Duplicate catalogue identity");
export type FoundationBillingCatalogue = z.infer<typeof catalogue>;

/** Exact public DTO; decimal cents remain canonical strings across transport. */
export function parseFoundationBillingCatalogue(input: unknown): FoundationBillingCatalogue {
  const parsed = catalogue.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation billing catalogue");
  return parsed.data;
}

/** No automatic retries: the same rule will apply to command adapters whose
 * server transaction may commit before a transport timeout is observed.
 */
export async function readFoundationBillingCatalogue(
  api: FoundationPublicApi
): Promise<FoundationBillingCatalogue> {
  const { data, error } = await api.rpc("billing_catalogue");
  if (error) throw new Error("Foundation billing catalogue unavailable");
  return parseFoundationBillingCatalogue(data);
}
