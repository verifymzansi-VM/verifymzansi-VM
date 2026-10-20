import { z } from "zod";

/** Ordinary ZA national number syntax only. This does not establish allocation,
 * number type, SMS/WhatsApp capability, availability or control of the number.
 * Never reuse account-phone proof or infer verification from this result.
 * ICASA: https://www.icasa.org.za/pages/numbering (checked 2026-10-20).
 */
function canonicalNumber(input: string): string | null {
  if (input.length > 64 || !/^[0-9+ ()-]+$/.test(input)) return null;
  let depth = 0;
  for (const character of input) {
    if (character === "(" && ++depth > 1) return null;
    if (character === ")" && --depth < 0) return null;
  }
  if (depth !== 0) return null;
  // Recognise only an explicitly parenthesised domestic trunk after +27/0027.
  // A bare extra digit is invalid rather than silently discarded.
  let value = input.trim().replace(/^(\+27|0027) *\(0\) */, "$1");
  value = value.replace(/[ ()-]/g, "");
  if (value.startsWith("0027")) value = "+27" + value.slice(4);
  else if (value.startsWith("0")) value = "+27" + value.slice(1);
  return /^\+27[1-9][0-9]{8}$/.test(value) ? value : null;
}

/** Stored DTOs must already be canonical; never silently repair output. */
export const storedSaBusinessContactNumberSchema = z.string().regex(/^\+27[1-9][0-9]{8}$/);

export const saBusinessContactNumberInputSchema = z.string().transform((input, context) => {
  const number = canonicalNumber(input);
  if (number === null) {
    context.addIssue({ code: "custom", message: "Enter a South African business phone number" });
    return z.NEVER;
  }
  return number;
});

export function parseSaBusinessContactNumber(input: unknown): string {
  const result = saBusinessContactNumberInputSchema.safeParse(input);
  if (!result.success) throw new Error("Invalid South African business contact number");
  return result.data;
}
