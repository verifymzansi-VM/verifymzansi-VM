import { formatZAR } from "@/lib/utils/format";
import {
  checkoutDropOffPercent,
  SALES_CATEGORY_LABELS,
  type StaffSalesSummary,
} from "@/lib/foundation/staff-sales";
import { AdminCard } from "./commercial-action";

const VAT_STATUS: Record<StaffSalesSummary["vat"]["vat_status"], string> = {
  not_registered: "Not registered",
  registered: "Registered",
  undecided: "Not set",
};

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/**
 * "Sales and VAT" on the staff payments page: sales of the last 12 months
 * (net of refunds) with the VAT alert at R1.8 million, online checkout
 * drop-off over 30 days, and sales by product and term. Read from the
 * database (api.get_staff_sales_summary); null when it could not be read.
 */
export function SalesSummary({ summary }: { summary: StaffSalesSummary | null }) {
  if (!summary)
    return (
      <p role="alert" className="text-sm text-destructive">
        Sales figures could not be loaded. Reload the page.
      </p>
    );
  const { vat, checkouts, products } = summary;
  const dropOff = checkoutDropOffPercent(checkouts);
  return (
    <AdminCard
      title="Sales and VAT"
      description="Paid in the last 12 months, less refunds. Each payment counts on the day it was paid."
    >
      {vat.alert ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm font-medium"
        >
          VAT alert: sales passed {formatZAR(vat.alert_cents)} in the last 12 months. VAT
          registration is compulsory from {formatZAR(vat.compulsory_cents)}: speak to the
          accountant.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Figure
          label="Last 12 months"
          value={formatZAR(vat.net_cents)}
          note={`${vat.payments.toLocaleString("en-ZA")} ${vat.payments === 1 ? "payment" : "payments"}`}
        />
        <Figure
          label="VAT"
          value={VAT_STATUS[vat.vat_status]}
          note={vat.alert ? undefined : `Alert at ${formatZAR(vat.alert_cents)}`}
        />
        <Figure
          label="Checkout drop-off, 30 days"
          value={dropOff === null ? "None started" : `${dropOff}%`}
          note={`${checkouts.paid.toLocaleString("en-ZA")} of ${checkouts.started.toLocaleString("en-ZA")} online checkouts paid`}
        />
      </div>
      {checkouts.started > checkouts.paid ? (
        <p className="text-sm text-muted-foreground">
          Not paid: {checkouts.failed} failed · {checkouts.cancelled} cancelled ·{" "}
          {checkouts.expired} expired · {checkouts.open} still open
        </p>
      ) : null}
      {products.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Sales of the last 12 months by product and term</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Product
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  Payments
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Sales
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((row) => (
                <tr key={`${row.category}:${row.term_days ?? "none"}`} className="border-t">
                  <td className="py-2 pr-4">
                    {SALES_CATEGORY_LABELS[row.category]}
                    {row.term_days ? (
                      <span className="block text-xs text-muted-foreground">
                        {row.term_days} days
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {row.payments.toLocaleString("en-ZA")}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right tabular-nums">
                    {formatZAR(row.net_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No sales in the last 12 months.</p>
      )}
    </AdminCard>
  );
}
