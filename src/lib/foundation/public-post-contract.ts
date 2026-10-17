import { z } from "zod";

export const foundationInstant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/)
  .pipe(z.iso.datetime({ offset: true }));
const key = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const cents = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,11})$/)
  .pipe(z.string().refine((value) => Number(value) <= 100000000000));
export const publicPostCoreSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["listing", "business", "event"]),
  area: z.enum(["market", "business", "tourism_events"]),
  category: key,
  activity: key.nullable(),
  title: z.string().min(1).max(120),
  price_mode: z.enum(["amount", "free", "on_request"]).nullable(),
  price_negotiable: z.boolean(),
  price_cents: cents.nullable(),
  province: key,
  city: key.nullable(),
  locality: z.string().min(1).max(120),
  condition: z.enum(["new", "like_new", "good", "fair", "for_parts"]).nullable(),
  published_at: foundationInstant,
});
export type FoundationPublicPostCore = z.infer<typeof publicPostCoreSchema>;

/** Shared read DTO invariants; these never grant publication or billing authority. */
export function validPublicPostCore(value: FoundationPublicPostCore): boolean {
  const kindArea =
    value.kind === "listing"
      ? value.area === "market"
      : value.kind === "event"
        ? value.area === "tourism_events"
        : value.area !== "market";
  const terms =
    value.kind !== "listing"
      ? value.price_mode === null && value.price_cents === null && value.condition === null
      : value.price_mode === "amount"
        ? value.price_cents !== null && Number(value.price_cents) > 0
        : value.price_mode === "free"
          ? value.price_cents === "0" && value.category !== "jobs_services"
          : value.price_mode === "on_request" && value.price_cents === null;
  const negotiable =
    !value.price_negotiable ||
    (value.kind === "listing" &&
      value.category !== "jobs_services" &&
      (value.price_mode === "amount" || value.price_mode === "on_request"));
  return kindArea && terms && negotiable;
}
