import { z } from "zod";

/** The six existing frontend business formats; null means not yet recorded. */
export const foundationBusinessTypeSchema = z.enum([
  "mall_store",
  "standalone_shop",
  "home_business",
  "mobile_service",
  "online_only",
  "market_stall",
]);
