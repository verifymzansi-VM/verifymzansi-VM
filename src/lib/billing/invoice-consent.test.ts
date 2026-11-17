import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { INVOICE_COOLING_OFF_CONSENT } from "./slot-checkout";

// The invoice email's written confirmation must be the wording the database
// records for invoice Pay now (internal.customer_invoice_consent).
it("uses the database's invoice cooling-off wording in the invoice request", () => {
  const sql = readFileSync(
    "database/foundation/current/functions/internal/customer_invoice_consent.sql",
    "utf8"
  );
  expect(sql).toContain(`'wording', '${INVOICE_COOLING_OFF_CONSENT}'`);
});
