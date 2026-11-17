import { REASON_CODES } from "../constants/verification";

const codes: ReadonlySet<string> = new Set(REASON_CODES);
// The identity review stores "<outcome> (<reason code>): <the reviewer's
// explanation>" (restored-identity-decision-route.ts).
const stored = /^(?:Rejected|Retake requested) \(([a-z_]{1,40})\): ([\s\S]+)$/;

/**
 * The reviewer's reason for sending an ID back, in the fields the restored
 * verification page shows for a step (`reason_code`, `reason_note`): the
 * explanation the reviewer wrote, and the reason code it was filed under (when
 * the page knows it). Text in any other form is shown as it was written.
 */
export function presentedReturnReason(reason: string | null | undefined): {
  reason_code: string | null;
  reason_note: string | null;
} {
  const text = reason?.trim();
  if (!text) return { reason_code: null, reason_note: null };
  const match = stored.exec(text);
  const note = match?.[2].trim();
  // A code the page does not know (renamed later, say) is left out; the
  // reviewer's explanation is what the member needs.
  if (match && note)
    return { reason_code: codes.has(match[1]) ? match[1] : null, reason_note: note };
  return { reason_code: null, reason_note: text };
}
