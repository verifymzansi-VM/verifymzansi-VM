import { z } from "zod";
import { foundationMediaUrl } from "./public-media-url";
// Only explicit owner assertions are presented. This projection contains no
// private contact numbers, owner identity, verification or funding authority.
export const frontendPostPresentationSchema = z.strictObject({
  business_contacts: z
    .strictObject({
      phone: z.string().nullable().optional(),
      whatsapp: z.string().nullable().optional(),
    })
    .optional(),
  // Whether the click-to-view route has a business number per channel; the
  // numbers themselves never enter the public read.
  business_contact_options: z
    .strictObject({ phone: z.boolean(), whatsapp: z.boolean() })
    .optional(),
  data: z
    .record(z.string(), z.unknown())
    .refine(
      (value) =>
        ![
          "owner_id",
          "user_id",
          "account_id",
          "role",
          "capabilities",
          "verified",
          "identity_verified",
          "phone",
          "whatsapp",
          "status",
          "entitlement_id",
        ].some((key) => key in value)
    ),
  media: z
    .array(
      z.strictObject({
        purpose: z.enum(["logo", "poster", "venue"]),
        position: z.number().int().min(0).max(9),
        object_key: z.string().regex(/^media\/[a-f0-9-]{36}$/),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
    )
    .max(12),
});
export type FrontendPostPresentation = z.infer<typeof frontendPostPresentationSchema>;
/** Bounded owner layout hints for video; never replace inspected image facts. */
export function presentedVideoLayout(frontend: FrontendPostPresentation | undefined) {
  const width = frontend?.data.layout_width ?? frontend?.data.media_width,
    height = frontend?.data.layout_height ?? frontend?.data.media_height;
  return typeof width === "number" &&
    typeof height === "number" &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= 20000 &&
    height <= 20000
    ? { width, height }
    : null;
}
export function presentedFormFields(frontend: FrontendPostPresentation | undefined) {
  if (!frontend) return {};
  const data = frontend.data;
  // Explicit mapping prevents a presentation record replacing canonical id,
  // title, status, pricing, contact gates or verification facts.
  const allowed = [
    "slug",
    "location_town",
    "location_address",
    "store_number",
    "map_directions",
    "email",
    "website",
    "social_links",
    "services_offered",
    "service_areas",
    "business_details",
    "category_details",
    "operating_hours",
    "payment_methods_accepted",
    "delivery_options",
    "layout_template",
    "event_details",
    "business_id",
    "category_key",
  ];
  const fields = Object.fromEntries(
    allowed.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]])
  );
  const logo = frontend.media.find((m) => m.purpose === "logo"),
    poster = frontend.media.find((m) => m.purpose === "poster");
  if (logo) fields.logo_url = foundationMediaUrl(logo.object_key);
  if (poster) fields.video_thumbnail = foundationMediaUrl(poster.object_key);
  if (
    data.source_attributes &&
    typeof data.source_attributes === "object" &&
    !Array.isArray(data.source_attributes)
  )
    fields.attributes = data.source_attributes;
  return fields;
}

/** A South African number in +27 form, as the click-to-view route serves it
 * (internal.reveal_post_phone): any landline or mobile for a call, a mobile
 * only for WhatsApp; null for anything else. */
export function revealableBusinessNumber(
  value: string | null | undefined,
  channel: "call" | "whatsapp"
) {
  const number = (value ?? "").replace(/[ ()-]/g, "");
  const match = /^(?:0|27|[+]27)([1-8][0-9]{8})$/.exec(number);
  if (!match || (channel === "whatsapp" && !/^[6-8]/.test(match[1]!))) return null;
  return `+27${match[1]}`;
}

/** Which business numbers a visitor can ask for with "Show number". Never the
 * numbers: a public page receives them only from the click-to-view route. */
export function businessContactAvailability(frontend: FrontendPostPresentation | undefined) {
  const options = frontend?.business_contact_options;
  const contacts = frontend?.business_contacts;
  const phone = options
    ? options.phone
    : revealableBusinessNumber(contacts?.phone, "call") !== null;
  const whatsapp = options
    ? options.whatsapp
    : revealableBusinessNumber(contacts?.whatsapp, "whatsapp") !== null;
  return { phone, whatsapp, email: false };
}
