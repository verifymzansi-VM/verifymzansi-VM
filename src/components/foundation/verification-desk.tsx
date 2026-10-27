import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/require-staff";
import { FoundationVerificationReview } from "./verification-review";

/** Presentation roles never grant evidence access. Both the native assignment
 * and the fresh lease/TOTP checks in the review API are required.
 */
export async function FoundationVerificationDesk() {
  const staff = await requireStaff("queue:view");
  const assigned = staff.assignedCapabilities ?? [];
  if (!assigned.includes("case:claim") || !assigned.includes("evidence:view"))
    redirect("/error?reason=forbidden");
  return <FoundationVerificationReview />;
}
