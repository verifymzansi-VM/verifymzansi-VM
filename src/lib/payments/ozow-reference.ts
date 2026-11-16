// Kept free of other imports: the receipt email (no Ozow call) shows the same
// reference that checkout sends to Ozow.

/** Ozow's beneficiary and payer reference fields hold at most 14 characters. */
const OZOW_REFERENCE_FIELD_MAX_LENGTH = 14;

/** The reference checkout sends as Ozow's beneficiary and payer reference:
 * the one on the member's bank statement. */
export function toOzowReferenceField(value: string): string {
  return value.replace(/[^A-Za-z0-9 -]/g, "").slice(0, OZOW_REFERENCE_FIELD_MAX_LENGTH);
}
