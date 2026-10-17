import { z } from "zod";

// Contract candidate for the target; source table names never determine entity kind.
export const postKindSchema = z.enum(["listing", "business", "event"]);
export const postAreaSchema = z.enum(["market", "business", "tourism_events"]);
const categoryKey = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_]+$/);
export const postIdentityContextSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("listing"),
    area: z.literal("market"),
    category_key: categoryKey,
  }),
  z.strictObject({
    kind: z.literal("business"),
    area: z.enum(["business", "tourism_events"]),
    category_key: categoryKey,
  }),
  z.strictObject({
    kind: z.literal("event"),
    area: z.literal("tourism_events"),
    category_key: categoryKey,
  }),
]);

const instant = z.iso
  .datetime({ offset: true })
  .regex(
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/,
    "Use seconds and at most millisecond precision"
  )
  .refine((value) => {
    const year = new Date(value).getUTCFullYear();
    return Number.isFinite(Date.parse(value)) && year >= 1 && year <= 9999;
  })
  .transform((value) => new Date(value).toISOString());
const eventDetail = z
  .strictObject({
    starts_at: instant,
    ends_at: instant,
    timezone: z
      .string()
      .max(80)
      .transform((value, context) => {
        try {
          const canonical = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions()
            .timeZone;
          if (canonical !== "UTC" && (!canonical.includes("/") || /^(posix|right)\//.test(value)))
            throw new Error("invalid zone");
          return canonical;
        } catch {
          context.addIssue({ code: "custom", message: "Use a supported IANA timezone" });
          return z.NEVER;
        }
      }),
  })
  .refine((value) => {
    const duration = Date.parse(value.ends_at) - Date.parse(value.starts_at);
    return Number.isFinite(duration) && duration > 0 && duration <= 90 * 24 * 60 * 60 * 1000;
  }, "Event end must follow start within 90 days");

export function buildCoreDraftCommand(input: unknown) {
  const command = z
    .strictObject({ context: postIdentityContextSchema, detail: z.unknown() })
    .parse(input);
  const detail =
    command.context.kind === "event"
      ? eventDetail.parse(command.detail)
      : z.strictObject({}).parse(command.detail);
  return {
    p_kind: command.context.kind,
    p_area: command.context.area,
    p_category_key: command.context.category_key,
    p_detail: detail,
  };
}

/** Owner draft projection only; published, staff and detail DTOs are separate pending contracts. */
export function readCoreDraft(input: unknown) {
  const draft = z
    .strictObject({
      id: z.uuid(),
      kind: postKindSchema,
      area: postAreaSchema,
      category_key: categoryKey,
      status: z.literal("draft"),
      revision: z.number().int().positive(),
    })
    .parse(input);
  postIdentityContextSchema.parse({
    kind: draft.kind,
    area: draft.area,
    category_key: draft.category_key,
  });
  return draft;
}

export const postAreaLabels = {
  market: "Mzansi Market",
  business: "Mzansi Business",
  tourism_events: "Tourism & Events",
} as const;
