import { z } from "zod";
import type { BusinessType } from "@/types/enums";

export const CUSTOMER_ACCESS_OPTIONS = [
  {
    value: "visit",
    label: "Customers visit me",
    hint: "For example, a shop, salon, practice or market stall.",
  },
  {
    value: "travel",
    label: "I travel to customers",
    hint: "For example, plumbing or hair appointments at a customer's home.",
  },
  {
    value: "delivery",
    label: "I deliver orders",
    hint: "You or a courier take orders to your customers.",
  },
  {
    value: "online",
    label: "I sell or provide services online",
    hint: "For example, online orders or video consultations.",
  },
] as const;
export const customerAccessSchema = z
  .object({
    version: z.literal(2),
    methods: z
      .array(z.enum(["visit", "travel", "delivery", "online"]))
      .min(1, "Choose at least one way to serve customers."),
    premises: z.enum(["standalone_shop", "mall_store", "home_business", "market_stall"]).optional(),
    venue: z.string().trim().max(160).optional(),
    serviceAreas: z.string().trim().max(2000).optional(),
    deliveryAreas: z.string().trim().max(2000).optional(),
    nationwide: z.boolean().optional(),
    publishAddress: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (value.methods.includes("visit")) {
      if (!value.premises) issue("premises", "Choose where customers visit you.");
      if (["mall_store", "market_stall"].includes(value.premises ?? "") && !value.venue)
        issue("venue", "Enter the shopping centre or market name.");
    }
    if (value.methods.includes("travel") && !value.serviceAreas?.split(",").some((a) => a.trim()))
      issue("serviceAreas", "Add at least one service area.");
    if (
      value.methods.includes("delivery") &&
      !value.nationwide &&
      !value.deliveryAreas?.split(",").some((a) => a.trim())
    )
      issue("deliveryAreas", "Add a delivery area or choose nationwide delivery.");
  });
export type CustomerAccess = z.infer<typeof customerAccessSchema>;
export function readCustomerAccess(value: unknown): CustomerAccess {
  if (value && typeof value === "object" && "version" in value && value.version === 2) {
    const partial = value as Partial<CustomerAccess>;
    return {
      ...partial,
      version: 2,
      methods: Array.isArray(partial.methods)
        ? partial.methods.filter((method) =>
            CUSTOMER_ACCESS_OPTIONS.some((option) => option.value === method)
          )
        : [],
      publishAddress: partial.publishAddress === true,
    };
  }
  return { version: 2, methods: [], publishAddress: false };
}
export function legacyAccess(type: BusinessType): CustomerAccess {
  return {
    version: 2,
    methods: [type === "mobile_service" ? "travel" : type === "online_only" ? "online" : "visit"],
    ...(!["mobile_service", "online_only"].includes(type)
      ? { premises: type as CustomerAccess["premises"] }
      : {}),
    publishAddress: false,
  };
}
/**
 * Builds version-2 access from a business saved before customer access existed,
 * so editing it does not silently drop delivery, venue or service areas.
 */
export function legacyAccessFromRecord(record: {
  businessType: BusinessType;
  venue?: string;
  serviceAreas?: string[];
  deliveryRegions?: string[];
  deliveryAvailable: boolean;
  nationwide: boolean;
  city?: string;
  hasAddress: boolean;
}): CustomerAccess {
  const base = legacyAccess(record.businessType);
  const areas = (record.serviceAreas ?? []).join(", ");
  const regions = (record.deliveryRegions ?? []).join(", ");
  const nationwide =
    record.nationwide || (record.deliveryRegions ?? []).some((r) => /nationwide/i.test(r));
  const methods = [...base.methods];
  if (record.deliveryAvailable && !methods.includes("delivery")) methods.push("delivery");
  return {
    ...base,
    methods,
    venue: record.venue ?? "",
    serviceAreas: areas,
    ...(record.deliveryAvailable
      ? { nationwide, deliveryAreas: nationwide ? "" : regions || areas || record.city || "" }
      : {}),
    publishAddress: record.businessType !== "home_business" && record.hasAddress,
  };
}
/** Legacy readers keep a primary type; all customer methods are persisted separately. */
export function primaryBusinessType(access: CustomerAccess): BusinessType {
  return access.methods.includes("visit") && access.premises
    ? access.premises
    : access.methods.includes("travel")
      ? "mobile_service"
      : "online_only";
}
export function cleanCustomerAccess(access: CustomerAccess): CustomerAccess {
  return {
    version: 2,
    methods: [...new Set(access.methods)],
    ...(access.methods.includes("visit")
      ? {
          premises: access.premises,
          ...(["mall_store", "market_stall"].includes(access.premises ?? "")
            ? { venue: access.venue }
            : {}),
        }
      : {}),
    ...(access.methods.includes("travel") ? { serviceAreas: access.serviceAreas } : {}),
    ...(access.methods.includes("delivery")
      ? {
          nationwide: access.nationwide,
          deliveryAreas: access.nationwide ? undefined : access.deliveryAreas,
        }
      : {}),
    publishAddress: access.methods.includes("visit") && access.publishAddress,
  };
}
