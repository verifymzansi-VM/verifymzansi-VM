import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { foundationAccountProfileSchema } from "./account-profile";

const context = z
  .strictObject({
    version: z.literal(1),
    account_id: z.uuid(),
    email: z.email().max(254).nullable(),
    phone: z
      .string()
      .regex(/^\+27[0-9]{9}$/)
      .nullable(),
    profile: foundationAccountProfileSchema,
    totp_enrolled: z.boolean(),
    staff: z
      .strictObject({
        role: z.enum(["moderator", "governor", "admin"]),
        can_access: z.boolean(),
        assigned_capabilities: z.array(z.string().min(1).max(100)).max(128),
      })
      .nullable(),
  })
  .refine((value) => !value.staff?.can_access || value.totp_enrolled);

export type FoundationAccountContext = z.infer<typeof context>;
export class FoundationAccountContextError extends Error {
  constructor(readonly reason: "forbidden" | "unavailable") {
    super("Current account details are unavailable");
  }
}

export function parseFoundationAccountContext(input: unknown): FoundationAccountContext {
  const parsed = context.safeParse(input);
  if (!parsed.success) throw new FoundationAccountContextError("unavailable");
  return parsed.data;
}

/** Self-only current account view. Staff fields are UI hints; every protected
 * command still checks live session, factor freshness, role and capability.
 * No caller id, role metadata or automatic retry can change the subject.
 */
export async function readFoundationAccountContext(api: FoundationAuthenticatedApi) {
  try {
    const { data, error } = await api.rpc("get_my_account_context", {}, { get: false });
    if (error)
      throw new FoundationAccountContextError(error.code === "42501" ? "forbidden" : "unavailable");
    return parseFoundationAccountContext(data);
  } catch (error) {
    if (error instanceof FoundationAccountContextError) throw error;
    throw new FoundationAccountContextError("unavailable");
  }
}
