import { z } from "zod";
import type { FoundationPublicApi } from "./public-api";
import { buildFoundationPostSearch, parseFoundationPostSearch } from "./post-search";
import { foundationBusinessTypeSchema } from "./business-type";
import { foundationEventWindowSchema } from "./event-window-dto";
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
export async function searchFoundationCards(api: FoundationPublicApi, input: unknown) {
  const { data, error } = await api.rpc("search_post_cards", buildFoundationPostSearch(input));
  if (error) throw new Error("Posts could not be loaded");
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
    p_request: { ...request.p_request, presentation: true },
  });
  if (error) throw new Error("Posts could not be loaded");
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
export function foundationMediaUrl(key: string | null | undefined) {
  if (!key || !/^media\/[a-f0-9-]{36}$/.test(key)) return null;
  return `${(process.env.NEXT_PUBLIC_MEDIA_URL || "https://media.verifymzansi.com").replace(/\/$/, "")}/${key}`;
}
