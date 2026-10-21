import { z } from "zod";
import { foundationEventWindowSchema } from "./event-window-dto";
import type { FoundationPublicApi } from "./public-api";
import {
  foundationInstant,
  publicPostCoreSchema,
  validPublicPostCore,
} from "./public-post-contract";

const dimension = z.number().int().min(1).max(20000).nullable();
const focal = z.number().min(0).max(1).nullable();
const media = z
  .strictObject({
    purpose: z.enum(["cover", "gallery", "logo", "video"]),
    position: z.number().int().min(0).max(49),
    object_key: z.string().regex(/^media\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/),
    kind: z.enum(["image", "video"]),
    width: dimension,
    height: dimension,
    focal_x: focal,
    focal_y: focal,
  })
  .refine((value) => (value.purpose === "video") === (value.kind === "video"))
  .refine((value) => value.kind !== "image" || (value.width !== null && value.height !== null));
// Public seller card only: "Thando D.", avatar and identity badge. No ids,
// legal names, contact details or verification evidence.
const seller = z.strictObject({
  public_name: z.string().min(1).max(60).nullable(),
  avatar_object_key: z
    .string()
    .regex(/^media\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/)
    .nullable(),
  identity_verified: z.boolean(),
});
const detail = z
  .strictObject({
    ...publicPostCoreSchema.shape,
    description: z.string().max(5000).nullable(),
    visible_until: foundationInstant,
    event_window: foundationEventWindowSchema.nullable(),
    media: z.array(media).max(100),
    seller,
  })
  .refine(validPublicPostCore)
  .refine((value) => (value.kind === "event") === (value.event_window !== null))
  .refine(
    (value) =>
      new Set(value.media.map((row) => `${row.purpose}:${row.position}`)).size ===
      value.media.length
  )
  .refine(
    (value) =>
      new Set(value.media.map((row) => `${row.purpose}:${row.object_key}`)).size ===
      value.media.length
  );
const request = z.strictObject({ id: z.uuid().transform((value) => value.toLowerCase()) });
export type FoundationPublicPostDetail = z.infer<typeof detail>;

export function parseFoundationPublicPost(input: unknown): FoundationPublicPostDetail | null {
  if (input === null) return null; // Unavailable/foreign/expired is distinct from transport failure.
  const result = detail.safeParse(input);
  if (!result.success) throw new Error("Invalid foundation public post");
  return result.data;
}
export async function readFoundationPublicPost(
  api: FoundationPublicApi,
  input: unknown
): Promise<FoundationPublicPostDetail | null> {
  const parsed = request.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation public post request");
  const { data, error } = await api.rpc("get_public_post", { p_id: parsed.data.id });
  if (error) throw new Error("Foundation public post unavailable");
  const result = parseFoundationPublicPost(data);
  if (result !== null && result.id !== parsed.data.id)
    throw new Error("Invalid foundation public post");
  return result;
}
