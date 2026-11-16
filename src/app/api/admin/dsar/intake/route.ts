import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { handlePrivacyStaffRoute } from "@/lib/foundation/privacy-requests";
import { settleStaffCommand } from "@/lib/foundation/staff-command";

const log = createLogger("DsarIntake");

const intakeSchema = z.object({
  type: z.enum(["access", "correction", "deletion", "objection"]),
  requesterEmail: z.string().trim().toLowerCase().email().max(254),
  requesterPhone: z.string().trim().max(30).optional(),
  description: z.string().trim().min(10).max(2000),
  /** How the request arrived and how identity will be checked. */
  intakeNote: z.string().trim().min(10).max(1000),
  /** When the request actually arrived (for example by post). Defaults to now. */
  receivedAt: z.string().datetime({ offset: true }).optional(),
});

/**
 * POST /api/admin/dsar/intake
 *
 * Record a data request made outside the website (email, post, phone), for
 * someone who cannot sign in. The deadline runs from when it arrived, set
 * by the database from the deadline rules. Identity starts unverified and
 * must be checked manually before anything is disclosed.
 */
export async function POST(request: Request) {
  return handlePrivacyStaffRoute(request, log, "intake", async (api, body) => {
    const input = intakeSchema.strict().parse(body);
    const created = await settleStaffCommand(
      api.rpc(
        "record_frontend_privacy_intake",
        {
          p_type: input.type,
          p_email: input.requesterEmail,
          p_phone: input.requesterPhone || null,
          p_description: input.description,
          p_note: input.intakeNote,
          ...(input.receivedAt ? { p_received: input.receivedAt } : {}),
        },
        { get: false }
      ),
      z.strictObject({ id: z.uuid(), due_by: z.iso.datetime({ offset: true }) })
    );
    return {
      status: "created",
      requestId: created.id,
      reference: `DSAR-${created.id.slice(0, 8).toUpperCase()}`,
      dueBy: created.due_by,
    };
  });
}
