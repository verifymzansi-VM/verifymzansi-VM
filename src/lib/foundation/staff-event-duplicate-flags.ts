import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { foundationEventWindowSchema } from "./event-window-dto";
import { foundationInstant } from "./public-post-contract";

const id = z.uuid().transform((value) => value.toLowerCase());
const revision = z.number().int().min(1).max(2147483647);
const key = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const hidden = /[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069\ufeff]/;
const utf16 = (minimum: number, maximum: number) =>
  z.string().refine((value) => value.length >= minimum && value.length <= maximum);
// PostgreSQL report/note CHECK minimum counts Unicode codepoints; its input
// validator maximum counts UTF16 units. Enforce both without Zod-length ambiguity.
const storedStatement = (minimum: number, maximum: number) =>
  z.string().refine((value) => [...value].length >= minimum && value.length <= maximum);
const statement = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .pipe(storedStatement(minimum, maximum))
    .refine((value) => !hidden.test(value));
const pair = z
  .strictObject({ post_a: id, post_b: id })
  .refine((value) => value.post_a !== value.post_b);
const flag = z
  .strictObject({
    post_a: id,
    expected_revision_a: revision,
    post_b: id,
    expected_revision_b: revision,
    reason: statement(10, 2000),
  })
  .refine((value) => value.post_a !== value.post_b);
const generation = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .pipe(z.string().refine((value) => BigInt(value) <= BigInt("9223372036854775807")));
const report = z.strictObject({ report_id: id });
const fence = z.strictObject({ report_id: id, claim_generation: generation, claim_nonce: id });
const decision = z.strictObject({
  ...fence.shape,
  outcome: z.enum(["resolved", "dismissed"]),
  note: statement(5, 500),
});
const event = z.strictObject({
  id: z.uuid(),
  revision,
  title: utf16(5, 120),
  description: utf16(20, 5000),
  category: key,
  activity: key.nullable(),
  province: key,
  city: key.nullable(),
  locality: z.string().min(1).max(120),
  event_window: foundationEventWindowSchema,
});
const preview = z
  .strictObject({
    post_a: event,
    post_b: event,
    open_flag_id: z.uuid().nullable(),
  })
  .refine((value) => value.post_a.id < value.post_b.id);
const acknowledgement = z
  .strictObject({
    id: z.uuid(),
    status: z.literal("open"),
    reused: z.boolean(),
    post_a: z.uuid(),
    post_b: z.uuid(),
  })
  .refine((value) => value.post_a < value.post_b);
const claim = z.strictObject({
  subject: z.literal("report"),
  id: z.uuid(),
  claim_generation: generation,
  claim_nonce: z.uuid(),
  claim_expires_at: foundationInstant,
  renewals_left: z.number().int().min(0).max(4),
  revision: z.null(),
  edit_of: z.null(),
});
const reportedEvent = z
  .strictObject({
    id: z.uuid(),
    reported_revision: revision,
    current: event.nullable(),
  })
  .refine((value) => value.current === null || value.current.id === value.id);
const review = z
  .strictObject({
    id: z.uuid(),
    origin: z.literal("staff"),
    category: z.literal("duplicate_event"),
    description: storedStatement(10, 2000),
    status: z.literal("open"),
    created_at: foundationInstant,
    post_a: reportedEvent,
    post_b: reportedEvent,
  })
  .refine((value) => value.post_a.id < value.post_b.id);
const resolution = z.strictObject({ id: z.uuid(), status: z.enum(["resolved", "dismissed"]) });

export function buildFoundationDuplicateEventPreview(input: unknown) {
  const parsed = pair.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation duplicate-event pair");
  return { p_post_a: parsed.data.post_a, p_post_b: parsed.data.post_b };
}
export function buildFoundationDuplicateEventFlag(input: unknown) {
  const parsed = flag.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation duplicate-event flag");
  return {
    p_post_a: parsed.data.post_a,
    p_expected_revision_a: parsed.data.expected_revision_a,
    p_post_b: parsed.data.post_b,
    p_expected_revision_b: parsed.data.expected_revision_b,
    p_reason: parsed.data.reason,
  };
}
function buildFence(input: unknown) {
  const parsed = fence.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation report claim");
  return {
    p_report_id: parsed.data.report_id,
    p_claim_generation: parsed.data.claim_generation,
    p_claim_nonce: parsed.data.claim_nonce,
  };
}
async function result(
  pending: PromiseLike<{ data: unknown; error: { code?: string } | null }>,
  message: string
) {
  const response = await pending.then(
    (value) => value,
    () => {
      throw new Error(message);
    }
  );
  if (response.error) {
    if (response.error.code === "PT409")
      throw new Error("Foundation duplicate-event data changed; reload before continuing");
    throw new Error(message);
  }
  return response.data;
}
function canonical(a: string, b: string) {
  return [a, b].sort();
}

/** Actual caller token only. One command per operation; uncertain writes never retry. */
export async function previewFoundationDuplicateEvents(
  api: FoundationAuthenticatedApi,
  input: unknown
) {
  const command = buildFoundationDuplicateEventPreview(input);
  const parsed = preview.safeParse(
    await result(
      api.rpc("preview_duplicate_events", command),
      "Foundation duplicate-event preview unavailable"
    )
  );
  const [a, b] = canonical(command.p_post_a, command.p_post_b);
  if (!parsed.success || parsed.data.post_a.id !== a || parsed.data.post_b.id !== b)
    throw new Error("Invalid foundation duplicate-event preview response");
  return parsed.data;
}
export async function flagFoundationDuplicateEvents(
  api: FoundationAuthenticatedApi,
  input: unknown
) {
  const command = buildFoundationDuplicateEventFlag(input);
  const parsed = acknowledgement.safeParse(
    await result(
      api.rpc("flag_duplicate_events", command),
      "Foundation duplicate-event flag unavailable"
    )
  );
  const [a, b] = canonical(command.p_post_a, command.p_post_b);
  if (!parsed.success || parsed.data.post_a !== a || parsed.data.post_b !== b)
    throw new Error("Invalid foundation duplicate-event flag response");
  return parsed.data;
}
/** A report lease grants no enforcement authority. The claimed read validates its kind. */
export async function claimFoundationReport(api: FoundationAuthenticatedApi, input: unknown) {
  const request = report.safeParse(input);
  if (!request.success) throw new Error("Invalid foundation report claim");
  const parsed = claim.safeParse(
    await result(
      api.rpc("claim_queue_item", {
        p_subject: "report",
        p_id: request.data.report_id,
      }),
      "Foundation report claim unavailable"
    )
  );
  if (!parsed.success || parsed.data.id !== request.data.report_id)
    throw new Error("Invalid foundation report claim response");
  return parsed.data;
}
export async function readFoundationDuplicateEventFlag(
  api: FoundationAuthenticatedApi,
  input: unknown
) {
  const command = buildFence(input);
  const parsed = review.safeParse(
    await result(
      api.rpc("staff_review_report", command),
      "Foundation duplicate-event review unavailable"
    )
  );
  if (!parsed.success || parsed.data.id !== command.p_report_id)
    throw new Error("Invalid foundation duplicate-event review response");
  return parsed.data;
}
/** Closes the reviewed report only; it does not hide posts or restrict accounts. */
export async function resolveFoundationDuplicateEventFlag(
  api: FoundationAuthenticatedApi,
  input: unknown
) {
  const request = decision.safeParse(input);
  if (!request.success) throw new Error("Invalid foundation duplicate-event resolution");
  const command = {
    p_report_id: request.data.report_id,
    p_claim_generation: request.data.claim_generation,
    p_claim_nonce: request.data.claim_nonce,
    p_outcome: request.data.outcome,
    p_note: request.data.note,
  };
  const parsed = resolution.safeParse(
    await result(
      api.rpc("resolve_report", command),
      "Foundation duplicate-event resolution unavailable"
    )
  );
  if (
    !parsed.success ||
    parsed.data.id !== command.p_report_id ||
    parsed.data.status !== command.p_outcome
  )
    throw new Error("Invalid foundation duplicate-event resolution response");
  return parsed.data;
}
