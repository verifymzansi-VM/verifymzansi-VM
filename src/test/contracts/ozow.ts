import { z } from "zod";
// Source: Ozow Hub One API schema/event docs, reviewed 2026-10-03.
const status = z.enum(["Successful", "Incomplete", "Pending", "Error"]);
export const OzowFullDataSchema = z
  .object({
    SiteCode: z.string().min(1),
    TransactionId: z.uuid(),
    TransactionReference: z.string().min(1),
    Amount: z.string().regex(/^\d+\.\d{2}$/),
    Status: status,
    Optional1: z.string(),
    Optional2: z.string(),
    Optional3: z.string(),
    Optional4: z.string(),
    Optional5: z.string(),
    CurrencyCode: z.string().regex(/^[A-Z]{3}$/),
    IsTest: z.enum(["True", "False"]),
    StatusMessage: z.string(),
    Hash: z.string(),
    SubStatus: z.string().optional(),
    SubStatusDescription: z.string().optional(),
    MaskedAccountNumber: z.string().optional(),
    BankName: z.string().optional(),
    SmartIndicators: z.string().optional(),
    BankId: z.string().optional(),
    AccountNumber: z.string().optional(),
    PublicRecipientName: z.string().optional(),
  })
  .passthrough();
export const OzowTransactionEventSchema = z.object({
  type: z.literal("transaction.complete"),
  timestamp: z.iso.datetime(),
  data: z.union([
    OzowFullDataSchema,
    z.object({ id: z.uuid(), status, reason: z.string().nullable().optional() }).passthrough(),
  ]),
});
