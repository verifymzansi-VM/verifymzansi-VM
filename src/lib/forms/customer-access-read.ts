// What a public business page needs to show "How we serve customers", without
// zod: the summary renders in the browser, and zod would add about 28 KiB of
// compressed JavaScript to every business page. `customer-access.ts` keeps the
// zod schema for the forms; a unit test proves both accept and return the same.

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

const METHODS: readonly string[] = ["visit", "travel", "delivery", "online"];
const PREMISES: readonly string[] = [
  "standalone_shop",
  "mall_store",
  "home_business",
  "market_stall",
];

type Method = (typeof CUSTOMER_ACCESS_OPTIONS)[number]["value"];
type Premises = "standalone_shop" | "mall_store" | "home_business" | "market_stall";

export type ReadCustomerAccess = {
  version: 2;
  methods: Method[];
  premises?: Premises;
  venue?: string;
  serviceAreas?: string;
  deliveryAreas?: string;
  nationwide?: boolean;
  publishAddress: boolean;
};

const INVALID = Symbol("invalid");

/**
 * Unicode code points, as zod counts a string's length: a surrogate pair
 * (an emoji, for example) counts once, a lone surrogate counts as itself.
 */
function codePointLength(text: string): number {
  let count = text.length;
  for (let i = 0; i < text.length - 1; i++) {
    if ((text.charCodeAt(i) & 0xfc00) === 0xd800 && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      count--;
      i++;
    }
  }
  return count;
}

/** An optional trimmed string of at most `max` characters, as zod's `string().trim().max()`. */
function optionalText(value: unknown, max: number): string | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return INVALID;
  const trimmed = value.trim();
  return codePointLength(trimmed) > max ? INVALID : trimmed;
}

function listsSomething(value: string | undefined): boolean {
  return Boolean(value?.split(",").some((area) => area.trim()));
}

/**
 * The saved customer access when it is complete and valid, else null. Same
 * result as `customerAccessSchema.safeParse(value)` in `customer-access.ts`
 * (the success flag and the parsed data).
 */
export function readPublishedCustomerAccess(value: unknown): ReadCustomerAccess | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;

  if (input.version !== 2) return null;
  const methods = input.methods;
  if (!Array.isArray(methods) || methods.length < 1) return null;
  // An index loop, not every(): every() skips the holes of a sparse array.
  for (let i = 0; i < methods.length; i++) {
    const method: unknown = methods[i];
    if (typeof method !== "string" || !METHODS.includes(method)) return null;
  }

  const premises = input.premises;
  if (premises !== undefined && (typeof premises !== "string" || !PREMISES.includes(premises)))
    return null;
  const venue = optionalText(input.venue, 160);
  const serviceAreas = optionalText(input.serviceAreas, 2000);
  const deliveryAreas = optionalText(input.deliveryAreas, 2000);
  if (venue === INVALID || serviceAreas === INVALID || deliveryAreas === INVALID) return null;
  const nationwide = input.nationwide;
  if (nationwide !== undefined && typeof nationwide !== "boolean") return null;
  const publishAddress = input.publishAddress === undefined ? false : input.publishAddress;
  if (typeof publishAddress !== "boolean") return null;

  const access: ReadCustomerAccess = {
    version: 2,
    methods: methods as Method[],
    publishAddress,
  };
  if ("premises" in input) access.premises = premises as Premises | undefined;
  if ("venue" in input) access.venue = venue;
  if ("serviceAreas" in input) access.serviceAreas = serviceAreas;
  if ("deliveryAreas" in input) access.deliveryAreas = deliveryAreas;
  if ("nationwide" in input) access.nationwide = nationwide as boolean | undefined;

  // The schema's cross-field rules (superRefine).
  if (access.methods.includes("visit")) {
    if (!access.premises) return null;
    if (["mall_store", "market_stall"].includes(access.premises) && !access.venue) return null;
  }
  if (access.methods.includes("travel") && !listsSomething(access.serviceAreas)) return null;
  if (
    access.methods.includes("delivery") &&
    !access.nationwide &&
    !listsSomething(access.deliveryAreas)
  )
    return null;

  return access;
}
