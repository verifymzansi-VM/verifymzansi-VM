import "server-only";
import { cache } from "react";
import { z } from "zod";
import { readFoundationServerSession } from "./server-session";

const count = z.number().int().nonnegative();
const instant = z.iso.datetime({ offset: true });
export const foundationStaffDashboardSchema = z
  .strictObject({
    version: z.literal(1),
    role: z.enum(["moderator", "governor", "admin"]),
    generated_at: instant,
    counts: z.strictObject({
      reports: count,
      content: count,
      kyc: count,
      business_kyc: count,
      decisions: count,
    }),
    claims: z
      .array(
        z.strictObject({
          subject_id: z.uuid(),
          kind: z.enum(["content", "report", "identity"]),
          expires_at: instant,
        })
      )
      .max(40),
    platform: z
      .strictObject({ jobs_waiting: count, cost_alarms: count, active_staff: count })
      .nullable(),
  })
  .refine((value) => value.role === "admin" || value.platform === null);

/** React cache is request scoped. SQL rechecks live staff/TOTP authority; no
 * service-role client, actor parameter or editable profile metadata is used. */
export const readFoundationStaffDashboard = cache(async () => {
  const current = await readFoundationServerSession();
  const { data, error } = await current.api.rpc("get_staff_dashboard", {});
  if (error) throw new Error("Staff overview is temporarily unavailable");
  const overview = foundationStaffDashboardSchema.parse(data);
  if (overview.role !== current.account.staff?.role)
    throw new Error("Staff overview authority changed");
  return overview;
});
