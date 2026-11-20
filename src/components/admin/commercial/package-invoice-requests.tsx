"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPlanPrice } from "@/lib/constants/pricing";
import { formatSaLongDate } from "@/lib/utils/format";
import { PACKAGE_ADD_INVOICE_DUE_DAYS, packageAddInvoiceDueOn } from "@/lib/billing/slot-packages";
import {
  ActionMessage,
  AdminCard,
  ReasonField,
  SubmitButton,
  readForm,
  useCommercialAction,
} from "./commercial-action";

/** An open request in the staff queue (api.get_staff_package_invoice_requests). */
export type StaffPackageInvoiceRequestRow = {
  request_id: string;
  status: "requested" | "awaiting_approval" | "issued" | "declined" | "withdrawn";
  term_days: number;
  slots: number;
  total_cents: number;
  requested_at: string;
  customer_email: string | null;
  customer_name: string | null;
  identity_accepted: boolean;
  package_open: boolean;
  needs_approval: boolean;
  due_days: number | null;
  prepared_by_me: boolean;
  prepared_by_name: string | null;
  /** Slots added to the customer's running package (P4b), priced for
   * `days_left` whole days and ending with it (`package_ends_at`); the
   * package's whole days left now (`days_left_now`, null once it no longer
   * runs). Issued later, the invoice is for the fewer days at their price. */
  kind?: "add";
  days_left?: number;
  days_left_now?: number | null;
  package_ends_at?: string | null;
};

const requestedDate = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});

function RequestRow({
  request,
  canIssue,
  canApprove,
  approvalAboveCents,
}: {
  request: StaffPackageInvoiceRequestRow;
  canIssue: boolean;
  canApprove: boolean;
  approvalAboveCents: number;
}) {
  const { run, busy, message } = useCommercialAction();
  const [open, setOpen] = useState<"issue" | "decline" | null>(null);
  const who = request.customer_name ?? request.customer_email ?? "this customer";
  const add = request.kind === "add";
  const order = add
    ? `Add ${request.slots} ${request.slots === 1 ? "slot" : "slots"} · priced for ${request.days_left} days`
    : `${request.slots} slots × ${request.term_days} days`;
  const waiting = request.status === "awaiting_approval";
  const daysNow = request.days_left_now ?? null;
  // A new package is refused while the customer has one; an add needs it
  // running with 10 or more whole days left.
  const blocked = !request.identity_accepted
    ? "The customer's ID review is not accepted: no invoice can be issued."
    : add && daysNow === null
      ? "The customer's package has ended: decline this request."
      : add && daysNow !== null && daysNow < 10
        ? "Fewer than 10 days of the customer's package are left: decline this request."
        : !add && request.package_open
          ? "The customer already has a Multi-listing package: decline this request."
          : null;

  return (
    <li className="space-y-2 rounded-lg border p-3 text-sm" data-testid="package-invoice-request">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-medium">
          {request.customer_name ?? "Member"}
          {request.customer_email ? (
            <span className="font-normal text-muted-foreground"> · {request.customer_email}</span>
          ) : null}
        </p>
        <p className="tabular-nums">
          {order} · <span className="font-semibold">{formatPlanPrice(request.total_cents)}</span>
        </p>
      </div>
      <p className="text-muted-foreground">
        Asked {requestedDate.format(new Date(request.requested_at))}
        {waiting
          ? ` · prepared by ${request.prepared_by_me ? "you" : (request.prepared_by_name ?? "another staff member")}, due ${add ? `${PACKAGE_ADD_INVOICE_DUE_DAYS} days after it is issued or on the package's last day if sooner` : `${request.due_days} days after it is issued`}; waits for a second admin`
          : request.needs_approval
            ? ` · above ${formatPlanPrice(approvalAboveCents)}: a second admin approves it before it is issued`
            : ""}
      </p>
      {add && daysNow !== null && request.package_ends_at ? (
        <p className="text-muted-foreground" data-testid="package-add-days">
          {`Package ends ${requestedDate.format(new Date(request.package_ends_at))} · ${daysNow} whole days left now`}
          {daysNow < (request.days_left ?? 0)
            ? ` · issued now, the invoice is for ${daysNow} days at their lower price`
            : ""}
        </p>
      ) : null}
      {blocked ? <p className="font-medium text-destructive">{blocked}</p> : null}
      <ActionMessage message={message} />
      <div className="flex flex-wrap gap-2">
        {canIssue && request.status === "requested" ? (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => setOpen(open === "issue" ? null : "issue")}
          >
            {request.needs_approval ? "Prepare invoice" : "Issue invoice"}
          </Button>
        ) : null}
        {canApprove && waiting && !request.prepared_by_me ? (
          <Button
            type="button"
            className="h-11"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  `Approve and issue an invoice of ${formatPlanPrice(request.total_cents)} to ${who} for ${order}? Its number is kept even if it is voided later.`
                )
              )
                return;
              await run(
                { action: "package_invoice.approve", requestId: request.request_id },
                (data) => {
                  const reply = data as {
                    invoice_number?: string | null;
                    repeated?: boolean;
                  } | null;
                  return reply?.repeated
                    ? `Invoice ${reply.invoice_number ?? ""} was already approved.`
                    : `Invoice ${reply?.invoice_number ?? ""} issued.`;
                }
              );
            }}
          >
            Approve and issue
          </Button>
        ) : null}
        {canIssue ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => setOpen(open === "decline" ? null : "decline")}
          >
            Decline
          </Button>
        ) : null}
      </div>
      {open === "issue" ? (
        <form
          className="space-y-3"
          aria-label={`Issue an invoice to ${who}`}
          onSubmit={async (event) => {
            event.preventDefault();
            const values = readForm(event.currentTarget);
            if (
              !window.confirm(
                request.needs_approval
                  ? `Prepare an invoice of ${formatPlanPrice(request.total_cents)} to ${who} for ${order}? A second admin approves it before it is issued.`
                  : `Issue an invoice of ${formatPlanPrice(request.total_cents)} to ${who} for ${order}? Its number is kept even if it is voided later.`
              )
            )
              return;
            const done = await run(
              {
                action: "package_invoice.issue",
                requestId: request.request_id,
                // An add's due date is set by the database (3 days, or the
                // package's last day if sooner).
                dueDays: add ? PACKAGE_ADD_INVOICE_DUE_DAYS : Number(values.dueDays),
                reason: values.reason,
              },
              (data) => {
                const reply = data as {
                  status?: string;
                  invoice_number?: string | null;
                  repeated?: boolean;
                } | null;
                if (reply?.status === "awaiting_approval")
                  return "Prepared. A second admin approves it before it is issued.";
                return reply?.repeated
                  ? `Invoice ${reply.invoice_number ?? ""} was already issued with these details.`
                  : `Invoice ${reply?.invoice_number ?? ""} issued. The customer is told it is ready.`;
              }
            );
            if (done) setOpen(null);
          }}
        >
          {add && request.package_ends_at ? (
            <p className="text-sm" data-testid="package-add-due">
              {`Due ${formatSaLongDate(`${packageAddInvoiceDueOn(request.package_ends_at, new Date())}T12:00:00+02:00`)} (${PACKAGE_ADD_INVOICE_DUE_DAYS} days after it is issued, or the package's last day if sooner)`}
            </p>
          ) : (
            <label className="block text-sm">
              <span className="font-medium">Days to pay</span>
              <input
                name="dueDays"
                type="number"
                inputMode="numeric"
                required
                min={1}
                max={30}
                defaultValue={7}
                className="mt-1 block w-full rounded-md border bg-background p-2 sm:w-40"
              />
            </label>
          )}
          <ReasonField />
          <SubmitButton busy={busy}>
            {request.needs_approval ? "Prepare for approval" : "Issue invoice"}
          </SubmitButton>
        </form>
      ) : null}
      {open === "decline" ? (
        <form
          className="space-y-3"
          aria-label={`Decline the request of ${who}`}
          onSubmit={async (event) => {
            event.preventDefault();
            const values = readForm(event.currentTarget);
            const done = await run(
              {
                action: "package_invoice.decline",
                requestId: request.request_id,
                reason: values.reason,
              },
              "Request declined. No invoice was issued."
            );
            if (done) setOpen(null);
          }}
        >
          <ReasonField />
          <SubmitButton busy={busy}>Decline request</SubmitButton>
        </form>
      ) : null}
    </li>
  );
}

/**
 * Members' requests for a Multi-listing package invoice (roadmap P4e), oldest
 * first. Staff issue the invoice at the price asked for (a second admin
 * approves one above R50 000), or decline the request. The database prices,
 * numbers and checks everything again; the invoice then appears under
 * Invoices. Shown only while requests are open.
 */
export function PackageInvoiceRequestPanel({
  canIssue,
  canApprove,
  requests,
  approvalAboveCents,
}: {
  canIssue: boolean;
  canApprove: boolean;
  requests: StaffPackageInvoiceRequestRow[];
  approvalAboveCents: number;
}) {
  if (requests.length === 0) return null;
  return (
    <AdminCard
      title="Package invoice requests"
      description={`Members asked for an invoice for a Multi-listing package. Issue it at the price asked for, or decline it. Above ${formatPlanPrice(approvalAboveCents)} a second admin approves it before it is issued.`}
    >
      <ul className="space-y-2">
        {requests.map((request) => (
          <RequestRow
            key={request.request_id}
            request={request}
            canIssue={canIssue}
            canApprove={canApprove}
            approvalAboveCents={approvalAboveCents}
          />
        ))}
      </ul>
    </AdminCard>
  );
}
