import Link from "next/link";
import { requireStaff } from "@/lib/auth/require-staff";
import { BrandLogo } from "@/components/shared/brand-logo";
import {
  AUTHORITY_REQUESTS_PATH,
  OUTCOME_LABELS,
  disclosureNumber,
  lookupKindLabel,
} from "@/lib/admin/authority-requests";
import { formatDateTime } from "@/lib/utils/format";
import { loadDisclosureRecord } from "../load-record";
import { PrintSheetButton } from "../record-parts";
import { DisclosureRecordView, DisclosureRequestRows } from "../record-view";

export const metadata = {
  title: "Disclosure sheet — Admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * The print disclosure sheet: what is handed to the authority, printed or
 * saved as PDF from the browser's print dialog. Loading it is logged as
 * "printed". A watermark with the disclosure number, the staff member and the
 * time covers the page, and the same line heads and ends the sheet.
 */
export default async function DisclosureSheetPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff("identity:disclose");
  const { id } = await params;
  const { disclosure, records } = await loadDisclosureRecord(id, "print");
  const number = disclosureNumber(disclosure.number);
  const printedAt = formatDateTime(new Date());
  const by = disclosure.opened_by_name ?? "VerifyMzansi staff";
  const stamp = `${number} · ${disclosure.reference} · ${by} · ${printedAt}`;
  const watermark = `CONFIDENTIAL · ${number} · ${by} · ${printedAt}`;
  return (
    <div className="space-y-4">
      <div className="no-print flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Print this sheet, or choose &ldquo;Save as PDF&rdquo; in the print dialog. Don&apos;t send
          it by email or chat.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={`${AUTHORITY_REQUESTS_PATH}/${disclosure.id}`}
            prefetch={false}
            className="inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium"
          >
            Back to the record
          </Link>
          <PrintSheetButton />
        </div>
      </div>

      <article
        data-disclosure-sheet
        className="relative max-w-4xl overflow-hidden rounded-xl border bg-white p-6 text-slate-900 sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex select-none flex-col justify-around overflow-hidden"
          style={{ WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
        >
          {Array.from({ length: 6 }, (_, row) => (
            <p
              key={row}
              className="-rotate-[24deg] whitespace-nowrap text-center text-2xl font-bold uppercase tracking-widest text-slate-900/[0.07]"
            >
              {watermark} · {watermark}
            </p>
          ))}
        </div>

        {/* Printed on every page: a fixed element repeats on each printed page. */}
        <p
          aria-hidden="true"
          className="hidden bg-white text-xs text-slate-600 print:block"
          style={{ position: "fixed", top: 0, left: 0, right: 0 }}
        >
          {stamp}
        </p>
        <p
          aria-hidden="true"
          className="hidden bg-white text-xs text-slate-600 print:block"
          style={{ position: "fixed", bottom: 0, left: 0, right: 0 }}
        >
          {stamp}
        </p>
        <div className="relative space-y-6 print:py-6">
          <div className="space-y-3 border-b border-slate-300 pb-4">
            <p className="text-xs text-slate-600 print:hidden">{stamp}</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <BrandLogo size="sm" />
              <p className="text-sm font-semibold uppercase tracking-wider">
                Identity record disclosure {number}
              </p>
            </div>
          </div>

          <section className="space-y-2">
            <h1 className="font-display text-xl font-semibold">The request</h1>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
              <DisclosureRequestRows disclosure={disclosure} termClassName="text-slate-600" />
              <dt className="text-slate-600">Reason</dt>
              <dd className="whitespace-pre-line break-words">{disclosure.reason}</dd>
              <dt className="text-slate-600">Searched by</dt>
              <dd className="break-words">
                {lookupKindLabel(disclosure.lookup_kind)}
                {disclosure.lookup_value ? `: ${disclosure.lookup_value}` : ""}
              </dd>
              <dt className="text-slate-600">Opened by</dt>
              <dd>
                {by}, {formatDateTime(disclosure.opened_at)}
              </dd>
              <dt className="text-slate-600">Result</dt>
              <dd>{OUTCOME_LABELS[disclosure.outcome]}</dd>
            </dl>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-lg font-semibold">The record</h2>
            {records.length === 0 ? (
              <p className="text-sm">
                No account on VerifyMzansi matches this search on the date and time above.
              </p>
            ) : (
              records.map((record) => (
                <div
                  key={record.account_id}
                  className="break-inside-avoid border-t border-slate-200 pt-4"
                >
                  <DisclosureRecordView disclosureId={disclosure.id} record={record} />
                </div>
              ))
            )}
          </section>

          <div className="border-t border-slate-300 pt-3 text-xs text-slate-600">
            <p className="print:hidden">{stamp}</p>
            <p>
              Disclosed by VerifyMzansi in answer to the request above. Confidential: for the
              requesting authority only. Not to be copied into email or chat.
            </p>
          </div>
        </div>
      </article>
    </div>
  );
}
