import { z } from "zod";
import type { FoundationPublicApi } from "./public-api";
import { buildFoundationPostSearch, parseFoundationPostSearch } from "./post-search";
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
export function foundationMediaUrl(key: string | null | undefined) {
  if (!key || !/^media\/[a-f0-9-]{36}$/.test(key)) return null;
  return `${(process.env.NEXT_PUBLIC_MEDIA_URL || "https://media.verifymzansi.com").replace(/\/$/, "")}/${key}`;
}
