import "server-only";

/**
 * What an invoice shows that the owner enters as server-side settings (Worker
 * secrets), never in the repository: the seller's street address and the bank
 * account for a bank transfer. When a setting is missing or not valid, the
 * invoice leaves that part out (no address line; no bank transfer section,
 * only "Pay now"). Nothing here is logged.
 */

type Environment = Record<string, string | undefined>;

export interface InvoiceBankDetails {
  accountName: string;
  bankName: string;
  accountNumber: string;
  branchCode: string;
}

const text = (value: string | undefined, max: number) => {
  const trimmed = value?.trim().replace(/\s+/g, " ") ?? "";
  return trimmed.length >= 2 && trimmed.length <= max && !/[<>]/.test(trimmed) ? trimmed : null;
};

/** The bank account for a bank transfer, only when all four settings are set
 * and look right (an account number of 6 to 16 digits, a branch code of 4 to 8
 * digits; spaces allowed); otherwise null. */
export function invoiceBankDetails(
  environment: Environment = process.env
): InvoiceBankDetails | null {
  const accountName = text(environment.INVOICE_BANK_ACCOUNT_NAME, 120);
  const bankName = text(environment.INVOICE_BANK_NAME, 80);
  const accountNumber = environment.INVOICE_BANK_ACCOUNT_NUMBER?.replace(/\s+/g, "") ?? "";
  const branchCode = environment.INVOICE_BANK_BRANCH_CODE?.replace(/\s+/g, "") ?? "";
  if (!accountName || !bankName) return null;
  if (!/^\d{6,16}$/.test(accountNumber) || !/^\d{4,8}$/.test(branchCode)) return null;
  return { accountName, bankName, accountNumber, branchCode };
}

/** The seller's street address, one line (commas separate its parts), only
 * when set; the owner has not confirmed one yet, so it is never defaulted. */
export function invoiceSellerAddress(environment: Environment = process.env): string | null {
  return text(environment.INVOICE_SELLER_ADDRESS, 300);
}
