import Link from "next/link";
import { requireStaff } from "@/lib/auth/require-staff";
import { Printer, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AUTHORITY_REQUESTS_PATH,
  OUTCOME_LABELS,
  disclosureNumber,
} from "@/lib/admin/authority-requests";
import { formatDateTime } from "@/lib/utils/format";
import { loadDisclosureRecord } from "./load-record";
import { RecordCloser } from "./record-parts";
import { DisclosureRecordView } from "./record-view";

export const metadata = {
  title: "Authority request record — Admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AuthorityRequestRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff("identity:disclose");
  const { id } = await params;
  const { disclosure, records } = await loadDisclosureRecord(id, "view");
  const kept = records.some((record) => "verified_at" in record);
  return (
    <div className="space-y-6">
      <RecordCloser closesAt={disclosure.closes_at} />
      <PageHeader
        title="Authority requests"
        description="Open a member's kept identity record to answer a police or court request. Admins and governors only. Every opening is logged."
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Authority requests", href: AUTHORITY_REQUESTS_PATH },
        ]}
      />
      <div
        role="status"
        className="flex max-w-5xl items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
      >
        <ScrollText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <strong className="font-semibold">
            Logged as disclosure {disclosureNumber(disclosure.number)}.
          </strong>{" "}
          Opened by {disclosure.opened_by_name ?? "you"} on {formatDateTime(disclosure.opened_at)}{" "}
          for {disclosure.reference}. This record closes by itself 15 minutes after it was opened;
          opening it again is logged again.
        </p>
      </div>
      <Card className="max-w-5xl space-y-5 p-4 sm:p-6">
        <div>
          <h2 className="font-display text-lg font-semibold">
            {kept ? "Kept identity record" : OUTCOME_LABELS[disclosure.outcome]}
          </h2>
          {disclosure.match_count > records.length && (
            <p className="text-sm text-muted-foreground">
              {disclosure.match_count} accounts match; the {records.length} most recent are shown.
            </p>
          )}
        </div>
        {records.length === 0 ? (
          <p className="text-sm">
            Nobody matches this search. The search is logged as{" "}
            {disclosureNumber(disclosure.number)}, so you can answer the request that no record was
            found.
          </p>
        ) : (
          <div className="divide-y">
            {records.map((record) => (
              <div key={record.account_id} className="py-4 first:pt-0 last:pb-0">
                <DisclosureRecordView disclosureId={disclosure.id} record={record} />
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:justify-end">
          <Button asChild className="h-11 w-full px-5 sm:w-auto">
            <Link href={`${AUTHORITY_REQUESTS_PATH}/${disclosure.id}/sheet`} prefetch={false}>
              <Printer className="h-4 w-4" />
              Print disclosure sheet
            </Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          The sheet carries the disclosure number, the reference, your name and the time on every
          page. Printing is logged. Don&apos;t copy these details into email or chat.
        </p>
      </Card>
    </div>
  );
}
