import "server-only";
import { z } from "zod";
import { foundationServerPublicApi } from "./server-public";
import type { FoundationPublicApi } from "./public-api";
import { createLogger } from "@/lib/utils/logger";
import { logDegradedRead } from "@/lib/utils/request-failure";

const log = createLogger("VatRegistration");

const vatRegistrationSchema = z.strictObject({
  status: z.enum(["not_registered", "registered", "undecided"]),
  vat_number: z
    .string()
    .regex(/^[0-9A-Za-z -]{5,30}$/)
    .nullable(),
});
export type VatRegistration = z.infer<typeof vatRegistrationSchema>;

/** The words after "VAT status:" for a VAT setting; null while undecided. */
export function vatStatusWording(registration: VatRegistration): string | null {
  if (registration.status === "not_registered") return "not registered for VAT";
  if (registration.status === "registered" && registration.vat_number)
    return `registered for VAT, VAT number ${registration.vat_number}`;
  return null;
}

export async function readVatRegistration(api: FoundationPublicApi): Promise<VatRegistration> {
  const { data, error } = await api.rpc("get_vat_registration", {}, { get: false });
  if (error) throw new Error("Foundation VAT setting unavailable");
  const parsed = vatRegistrationSchema.safeParse(data);
  if (!parsed.success) throw new Error("Invalid foundation VAT setting");
  return parsed.data;
}

/**
 * The VAT status the public pages state, read from the database setting the
 * invoices check (api.get_vat_registration, public like the price catalogue,
 * 20261121090305_staff_sales_and_vat.sql). Null when it cannot be read or is
 * undecided: the pages then leave the VAT line out rather than guess.
 */
export async function readVatStatusWording(): Promise<string | null> {
  try {
    return vatStatusWording(await readVatRegistration(foundationServerPublicApi()));
  } catch (error) {
    logDegradedRead(log, "VAT setting unavailable", error);
    return null;
  }
}
