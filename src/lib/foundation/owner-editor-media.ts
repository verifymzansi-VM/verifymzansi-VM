import { z } from "zod";

const dimension = z.number().int().min(1).max(20000).nullable();
/** Owned references only. Object keys and byte delivery are separate contracts. */
export const foundationOwnerMediaSchema = z
  .strictObject({
    object_id: z.uuid(),
    kind: z.enum(["image", "video"]),
    state: z.enum(["intent", "ready", "rejected", "cleanup_required", "deleted"]),
    purpose: z.enum(["cover", "gallery", "logo", "video"]),
    position: z.number().int().min(0).max(49),
    width: dimension,
    height: dimension,
    focal_x: z.number().min(0).max(1).nullable(),
    focal_y: z.number().min(0).max(1).nullable(),
  })
  .refine((item) => (item.purpose === "video") === (item.kind === "video"))
  .refine(
    (item) =>
      item.state !== "ready" ||
      item.kind !== "image" ||
      (item.width !== null && item.height !== null)
  );

export function hasValidOwnerMediaSlots(items: z.infer<typeof foundationOwnerMediaSchema>[]) {
  return (
    new Set(items.map((item) => `${item.purpose}/${item.position}`)).size === items.length &&
    new Set(items.map((item) => `${item.purpose}/${item.object_id}`)).size === items.length &&
    items.filter((item) => item.purpose === "cover").length <= 1 &&
    items.filter((item) => item.purpose === "logo").length <= 1
  );
}
