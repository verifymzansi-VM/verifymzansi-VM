import { createAdminClient } from "@/lib/supabase/admin";
import { fulfillPayment } from "./fulfillment";
import { validateOzowConfirmation } from "./confirmation";
import {
  getOzowPaymentRequestStatus,
  listOzowPaymentTransactions,
  isMockOzowEnabled,
} from "./ozow";
import type { PaymentRecordShape } from "./types";
import type { PaymentRow, PaymentStoreClient } from "./store";
import { auditPaymentCompleted, sendPaymentStatusEmail } from "./notifications";
import { scheduleBackgroundTask } from "@/lib/utils/background-task";
import { createLogger } from "@/lib/utils/logger";

export async function reconcileOzowPayment(
  payment: PaymentRecordShape,
  admin = createAdminClient(),
  options: { skipThrottle?: boolean; expire?: boolean } = {}
) {
  if (isMockOzowEnabled()) return { checked: true };
  if (
    payment.provider !== "ozow" ||
    !payment.provider_payment_id ||
    !payment.created_at ||
    !["pending", "failed", "expired"].includes(payment.status)
  )
    return { checked: false };
  if (!options.skipThrottle) {
    const { data: claimed, error: claimError } = await admin.rpc("claim_ozow_reconciliation", {
      p_payment_id: payment.id,
    });
    if (claimError) throw new Error("Unable to claim payment reconciliation");
    if (!claimed) return { checked: false };
  }
  const transactions = await listOzowPaymentTransactions(
    payment.provider_payment_id,
    payment.created_at
  );
  for (const transaction of transactions) {
    const error = validateOzowConfirmation(payment, transaction);
    if (error) throw new Error(`Ozow reconciliation rejected: ${error}`);
  }
  const successful = transactions.filter(
    (transaction) => transaction.status?.toLowerCase() === "successful"
  );
  if (successful.length > 1)
    throw new Error("Multiple successful Ozow transactions require investigation");
  if (successful.length === 1) {
    const transaction = successful[0];
    const result = await fulfillPayment(
      admin as never,
      payment,
      {
        reconciliation: true,
        ...transaction.rawPayload,
      },
      { id: transaction.transactionId!, merchantReference: transaction.merchantReference! }
    );
    if (result.outcome === "completed" || result.outcome === "recovered") {
      await auditPaymentCompleted({ ...payment, provider: "ozow" });
      scheduleBackgroundTask(
        sendPaymentStatusEmail({
          admin: admin as unknown as PaymentStoreClient,
          payment: payment as PaymentRow,
          status: "success",
          logContext: { paymentId: payment.id, transactionId: transaction.transactionId },
        }).catch(() =>
          createLogger("OzowReconciliation").warn("Recovered payment receipt could not be queued", {
            paymentId: payment.id,
          })
        ),
        "payment status email"
      );
    }
    return { checked: true, outcome: result.outcome };
  }
  // Expiry of the payment request is distinct from transaction success. Pending
  // bank transactions must remain recoverable even when the checkout link expires.
  if (
    transactions.some((transaction) =>
      ["pending", "incomplete"].includes(transaction.status?.toLowerCase() || "")
    )
  ) {
    return { checked: true, pendingTransaction: true };
  }
  if (
    options.expire !== false &&
    payment.status === "pending" &&
    (await getOzowPaymentRequestStatus(payment.provider_payment_id)) === "Expired"
  ) {
    const { error } = await admin
      .from("payments")
      .update({ status: "expired" })
      .eq("id", payment.id)
      .eq("status", "pending");
    if (error) throw new Error("Unable to persist provider payment expiry");
  }
  return { checked: true };
}
