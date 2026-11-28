import { z } from "zod";
import { externalUrlOrEmptySchema } from "./shared";

/** An event's social links (event_details.social_links), YouTube included. */
export const eventSocialLinksSchema = z
  .object({
    facebook: externalUrlOrEmptySchema("Enter a valid Facebook URL"),
    instagram: externalUrlOrEmptySchema("Enter a valid Instagram URL"),
    twitter: externalUrlOrEmptySchema("Enter a valid X / Twitter URL"),
    tiktok: externalUrlOrEmptySchema("Enter a valid TikTok URL"),
    youtube: externalUrlOrEmptySchema("Enter a valid YouTube URL"),
  })
  .optional();

/** Doors open, refunds and where tickets are sold (event_details), shared by
 * the event form schema and the tourism event schema. */
export const eventEntryFields = {
  doors_open: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time such as 18:30")
    .optional(),
  refund_policy: z.enum(["full_until_days", "only_if_cancelled", "no_refunds"]).optional(),
  refund_days: z.number().int().min(1).max(365).optional(),
  ticket_sales: z.enum(["online", "door", "both"]).optional(),
  gate_payment: z
    .array(z.enum(["cash", "card"]))
    .max(2)
    .optional(),
};
