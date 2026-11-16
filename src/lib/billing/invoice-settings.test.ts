import { describe, expect, it, vi } from "vitest";
import { invoiceBankDetails, invoiceSellerAddress } from "./invoice-settings";
import { FAKE_INVOICE_BANK } from "@/test/customer-invoice";

vi.mock("server-only", () => ({}));

const fake = {
  INVOICE_BANK_ACCOUNT_NAME: FAKE_INVOICE_BANK.accountName,
  INVOICE_BANK_NAME: FAKE_INVOICE_BANK.bankName,
  INVOICE_BANK_ACCOUNT_NUMBER: "0000 000 000",
  INVOICE_BANK_BRANCH_CODE: "000 000",
};

describe("invoice settings (server-side, never in the repository)", () => {
  it("gives the bank account only when all four settings are set and valid", () => {
    expect(invoiceBankDetails(fake)).toEqual(FAKE_INVOICE_BANK);
    for (const name of Object.keys(fake))
      expect(invoiceBankDetails({ ...fake, [name]: undefined }), name).toBeNull();
    expect(invoiceBankDetails({ ...fake, INVOICE_BANK_ACCOUNT_NUMBER: "12AB" })).toBeNull();
    expect(invoiceBankDetails({ ...fake, INVOICE_BANK_BRANCH_CODE: "12" })).toBeNull();
    expect(invoiceBankDetails({ ...fake, INVOICE_BANK_NAME: "<b>Bank</b>" })).toBeNull();
    expect(invoiceBankDetails({})).toBeNull();
  });

  it("gives the seller's address only when set (never a default)", () => {
    expect(invoiceSellerAddress({})).toBeNull();
    expect(invoiceSellerAddress({ INVOICE_SELLER_ADDRESS: "  " })).toBeNull();
    expect(invoiceSellerAddress({ INVOICE_SELLER_ADDRESS: " 1 Example Street,  Town " })).toBe(
      "1 Example Street, Town"
    );
  });
});
