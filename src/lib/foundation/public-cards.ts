import { z } from "zod";
import type { FoundationPublicApi } from "./public-api";
import { buildFoundationPostSearch, parseFoundationPostSearch } from "./post-search";
import { foundationBusinessTypeSchema } from "./business-type";
import { foundationEventWindowSchema } from "./event-window-dto";
import { frontendPostPresentationSchema } from "./post-presentation";
import { publicPostCoreSchema, validPublicPostCore } from "./public-post-contract";
export { foundationMediaUrl } from "./public-media-url";
const key = z
  .string()
  .regex(/^media\/[a-f0-9-]{36}$/)
  .nullable();
const extra = z.object({
  items: z
    .array(
      z.looseObject({ id: z.uuid(), preview: z.strictObject({ image_key: key, video_key: key }) })
    )
    .max(48),
});
/** The card read itself failed (not a refused reply), so repeating it would
 * only wait on the database again. */
export class FoundationPostsUnavailableError extends Error {
  constructor() {
    super("Posts could not be loaded");
  }
}
/** Public cards with their preview pictures, without presentations. */
export async function searchFoundationCards(api: FoundationPublicApi, input: unknown) {
  const { data, error } = await api.rpc("search_post_cards", buildFoundationPostSearch(input));
  if (error) throw new FoundationPostsUnavailableError();
  return parseCards(data);
}
function parseCards(data: unknown) {
  const enriched = extra.parse(data);
  const plain = parseFoundationPostSearch({
    ...(data as object),
    items: enriched.items.map(({ preview: _preview, ...item }) => item),
  });
  return {
    ...plain,
    items: plain.items.map((item) => ({
      ...item,
      preview: enriched.items.find((row) => row.id === item.id)!.preview,
    })),
  };
}

const presentation = z.strictObject({
  business_type: foundationBusinessTypeSchema.nullable(),
  event_window: foundationEventWindowSchema.nullable(),
  frontend: frontendPostPresentationSchema.optional(),
});
export type FoundationCardPresentation = z.infer<typeof presentation>;
const presented = z.object({
  presentation_contract: z.literal("restored-public-v1"),
  items: z.array(z.looseObject({ id: z.uuid(), presentation })).max(48),
});
/** Opt-in metadata leaves the deployed baseline response contract unchanged. */
export async function searchFoundationPresentedCards(api: FoundationPublicApi, input: unknown) {
  const request = buildFoundationPostSearch(input);
  const { data, error } = await api.rpc("search_post_cards", {
    p_request: { ...request.p_request, presentation: true, frontend_presentation: true },
  });
  if (error) throw new FoundationPostsUnavailableError();
  const enriched = presented.parse(data);
  const { presentation_contract: _contract, ...body } = data as Record<string, unknown>;
  const plain = parseCards({
    ...body,
    items: enriched.items.map(({ presentation: _presentation, ...item }) => item),
  });
  if (
    plain.items.length > (request.p_request.limit ?? 24) ||
    plain.items.some((item, index) => {
      const fields = enriched.items[index]!.presentation;
      return (
        (item.kind !== "business" && fields.frontend?.business_contacts !== undefined) ||
        (item.kind === "event") !== (fields.event_window !== null) ||
        (item.kind !== "business" && fields.business_type !== null)
      );
    })
  )
    throw new Error("Invalid public card presentation");
  return {
    ...plain,
    items: plain.items.map((item, index) => ({
      ...item,
      presentation: enriched.items[index]!.presentation,
    })),
  };
}

const showroomCard = z
  .strictObject({
    ...publicPostCoreSchema.shape,
    summary: z.string().max(300),
    is_new: z.boolean(),
    preview: z.strictObject({ image_key: key, video_key: key }),
  })
  .refine(validPublicPostCore);
const showroomPage = z
  .strictObject({ items: z.array(showroomCard).max(15) })
  .refine((page) => new Set(page.items.map((card) => card.id)).size === page.items.length);
export type FoundationShowroomCard = z.infer<typeof showroomCard>;
export interface FoundationShowroomRequest {
  showroom: "home" | "business" | "market" | "tourism";
  province?: string;
  city?: string;
}
/** The fair showroom order for one visitor area (20261122023000_fair_showroom.sql):
 * at most 15 cards (home) or 7 (an area), in showroom order, each with is_new. */
export async function loadFoundationShowroom(
  api: FoundationPublicApi,
  request: FoundationShowroomRequest
): Promise<FoundationShowroomCard[]> {
  const { data, error } = await api.rpc("showroom_feed", { p_request: { ...request } });
  if (error) throw new Error("Showroom could not be loaded");
  return showroomPage.parse(data).items;
}
