import { requireStaff } from "@/lib/auth/require-staff";
import Link from "next/link";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import {
  readStaffBankTransfers,
  readStaffBankTransfersWaiting,
  readStaffPaymentList,
  staffPaymentListFilter,
} from "@/lib/foundation/staff-payments";
import { BankTransferPanel } from "@/components/admin/commercial/bank-transfer-form";
import { InvoicePanel } from "@/components/admin/commercial/invoice-panel";
import { readStaffInvoices } from "@/lib/foundation/customer-invoices";
import { PaymentsPanel } from "@/components/admin/commercial/partners-panel";
import { OzowRefundAttention } from "@/components/admin/commercial/ozow-refund-actions";
import { PageHeader } from "@/components/layout/page-header";
import { readStaffOzowRefunds } from "@/lib/foundation/ozow-refunds";
import { ozowApiRefundsEnabled } from "@/lib/payments/ozow-refunds";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("AdminPayments");

const PAGE_SIZE = 50;

export const metadata = { title: "Payments & Refunds" };
export const dynamic = "force-dynamic";

export default async function PaymentsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const staff = await requireStaff("payments:view");
  const canRefund = staff.assignedCapabilities?.includes("payments:refund") === true;
  const params = await searchParams;
  const status = staffPaymentListFilter.safeParse(params.status).data;
  const parsedPage = Number(params.page || 1);
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100_000) : 1;
  const canConfirm = staff.assignedCapabilities?.includes("payments:confirm_transfer") === true;
  const {
    rows,
    total,
    needsAttention,
    awaitingApproval,
    transfersUnavailable,
    waiting,
    ozow,
    invoices,
  } = await (async () => {
    const { api } = await readFoundationServerSession();
    const result = await readStaffPaymentList(api, page, status);
    // Refunds through Ozow. Read while switched on; while off, only to know
    // whether typed references retired for Ozow payments (once refunds went
    // through Ozow). Off and never used, the page is exactly as before; a
    // failed read while off leaves it as before too.
    const apiRefunds = ozowApiRefundsEnabled();
    const refunds = await readStaffOzowRefunds(
      api,
      result.items.map((item) => item.id)
    ).catch((error: unknown) => {
      if (apiRefunds) throw error;
      return null;
    });
    const view =
      refunds && (apiRefunds || refunds.typed_reference_retired)
        ? {
            api: apiRefunds,
            retired: refunds.typed_reference_retired,
            refundable: refunds.payments.filter((p) => p.ozow_refundable).map((p) => p.payment_id),
            records: refunds.records,
            attention: refunds.attention,
          }
        : null;
    // Payments confirmed from a bank transfer show its reference, and the
    // transfers waiting for a second staff member are listed; the payments
    // list still loads if these reads fail, with a warning.
    let unavailable = false;
    const missing = (error: unknown) => {
      log.warn("Bank transfer details unavailable", { error });
      unavailable = true;
    };
    const [details, waitingTransfers, invoiceList] = await Promise.all([
      readStaffBankTransfers(
        api,
        result.items.map((item) => item.id)
      ).catch((error: unknown) => {
        missing(error);
        return [];
      }),
      readStaffBankTransfersWaiting(api)
        .then((read) => read.items)
        .catch((error: unknown) => {
          missing(error);
          return [];
        }),
      // Customer invoices (P2b): the payments list still loads without them.
      readStaffInvoices(api).catch((error: unknown) => {
        log.warn("Invoices unavailable", { error });
        return null;
      }),
    ]);
    const transfers = new Map(details.map((transfer) => [transfer.payment_id, transfer]));
    return {
      transfersUnavailable: unavailable,
      waiting: waitingTransfers,
      rows: result.items.map((item) => {
        const transfer = transfers.get(item.id);
        return transfer
          ? {
              ...item,
              bank_transfer: {
                bank_reference: transfer.bank_reference,
                cleared_on: transfer.cleared_on,
              },
            }
          : item;
      }),
      total: result.total,
      needsAttention: result.needs_attention,
      awaitingApproval: result.awaiting_approval,
      ozow: view,
      invoices: invoiceList,
    };
  })();

  const hrefFor = (nextPage: number) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (nextPage > 1) query.set("page", String(nextPage));
    const qs = query.toString();
    return qs ? `/admin/payments?${qs}` : "/admin/payments";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments & Refunds"
        description="Newest first. Refunds and chargebacks are for admins only."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Payments & Refunds" }]}
      />
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label>
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="mt-1 block rounded-md border bg-background p-2"
          >
            <option value="">All</option>
            <option value="needs_attention">needs attention (paid, not delivered)</option>
            <option value="awaiting_approval">refund waiting for approval</option>
            {[
              "pending",
              "processing",
              "complete",
              "failed",
              "expired",
              "refunded",
              "chargeback",
              "cancelled",
            ].map((s) => (
              <option key={s} value={s}>
                {s === "complete" ? "paid" : s}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-11 rounded-md border px-4">
          Filter
        </button>
      </form>
      {needsAttention > 0 || awaitingApproval > 0 ? (
        <p role="status" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {needsAttention > 0 && status !== "needs_attention" ? (
            <Link href="/admin/payments?status=needs_attention" className="font-medium underline">
              {needsAttention.toLocaleString("en-ZA")} paid but not delivered: needs attention
            </Link>
          ) : null}
          {awaitingApproval > 0 && status !== "awaiting_approval" ? (
            <Link href="/admin/payments?status=awaiting_approval" className="font-medium underline">
              {awaitingApproval.toLocaleString("en-ZA")}{" "}
              {awaitingApproval === 1 ? "refund waits" : "refunds wait"} for approval
            </Link>
          ) : null}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {status ? "" : "About "}
        {total.toLocaleString("en-ZA")} {total === 1 ? "payment" : "payments"}
        {total > PAGE_SIZE && ` · Page ${page} of ${Math.ceil(total / PAGE_SIZE)}`}
      </p>
      {transfersUnavailable ? (
        <p role="alert" className="text-sm text-destructive">
          Bank transfer details could not be loaded. Reload before refunding a payment.
        </p>
      ) : null}
      {canRefund || canConfirm || waiting.length > 0 ? (
        <BankTransferPanel canRecord={canRefund} canConfirm={canConfirm} waiting={waiting} />
      ) : null}
      {invoices ? (
        <InvoicePanel canIssue={canRefund} invoices={invoices.items} unpaid={invoices.unpaid} />
      ) : (
        <p role="alert" className="text-sm text-destructive">
          Invoices could not be loaded. Reload the page.
        </p>
      )}
      {ozow ? <OzowRefundAttention records={ozow.attention} /> : null}
      <PaymentsPanel
        payments={rows}
        canRefund={canRefund}
        ozow={
          ozow
            ? {
                api: ozow.api,
                retired: ozow.retired,
                refundable: ozow.refundable,
                records: ozow.records,
              }
            : undefined
        }
      />
      {(page > 1 || rows.length === PAGE_SIZE) && (
        <nav aria-label="Payment pages" className="flex gap-4 text-sm">
          {page > 1 && (
            <Link href={hrefFor(page - 1)} className="underline">
              Newer payments
            </Link>
          )}
          {rows.length === PAGE_SIZE && (!status || page * PAGE_SIZE < total) && (
            <Link href={hrefFor(page + 1)} className="underline">
              Older payments
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
