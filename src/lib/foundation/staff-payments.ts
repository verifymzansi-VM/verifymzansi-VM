import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { staffReason } from "./organisations";
import { settleStaffCommand } from "./staff-command";

const actualStatuses = [
  "pending",
  "complete",
  "failed",
  "expired",
  "refunded",
  "chargeback",
  "cancelled",
] as const;
export const staffPaymentFilter = z.enum([...actualStatuses, "processing"]);

export function readFrontendStaffPayments(
  api: FoundationAuthenticatedApi,
  page: number,
  status?: z.infer<typeof staffPaymentFilter>
) {
  return settleStaffCommand(
    api.rpc(
      "get_frontend_staff_payments",
      {
        p_page: page,
        ...(status ? { p_status: status } : {}),
      },
      { get: false }
    ),
    z.strictObject({
      total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      page: z.literal(page),
      items: z
        .array(
          z.strictObject({
            id: z.uuid(),
            user_id: z.uuid(),
            area: z.enum(["market", "business", "tourism_events", "all"]),
            amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            status: z.enum(actualStatuses),
            created_at: z.iso.datetime({ offset: true }),
            description: z.string().min(1).max(160),
          })
        )
        .max(50),
    })
  );
}

export function recordFrontendStaffPaymentReversal(
  api: FoundationAuthenticatedApi,
  id: string,
  kind: "refunded" | "chargeback",
  reason: string
) {
  return settleStaffCommand(
    api.rpc(
      "record_frontend_staff_payment_reversal",
      {
        p_id: id,
        p_kind: kind,
        p_reason: staffReason.parse(reason),
      },
      { get: false }
    ),
    z.strictObject({
      status: z.literal(kind),
      released_activations: z.number().int().nonnegative(),
    })
  );
}
