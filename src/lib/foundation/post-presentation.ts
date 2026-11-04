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
export function presentedFormFields(
  frontend: FrontendPostPresentation | undefined,
  business = false
) {
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
  if (business && frontend.business_contacts) {
    fields.phone = frontend.business_contacts.phone ?? null;
    fields.whatsapp = frontend.business_contacts.whatsapp ?? null;
  }
  if (
    data.source_attributes &&
    typeof data.source_attributes === "object" &&
    !Array.isArray(data.source_attributes)
  )
    fields.attributes = data.source_attributes;
  return fields;
}
