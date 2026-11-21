import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { requireStaff } from "@/lib/auth/require-staff";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import {
  listIdentityDisclosures,
  readStaffAuthenticatorHint,
  type DisclosureListItem,
} from "@/lib/foundation/identity-disclosures";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import {
  AUTHORITY_REQUESTS_PATH,
  DISCLOSURE_OPEN_MINUTES,
  disclosureNumber,
  earlierRequestStatus,
  minutesLeft,
} from "@/lib/admin/authority-requests";
import { formatDate } from "@/lib/utils/format";
import { createLogger } from "@/lib/utils/logger";
import { AuthorityRequestForm } from "./authority-request-form";

export const metadata = {
  title: "Authority requests — Admin",
  description: "Open a member's kept identity record to answer a police or court request.",
};
export const dynamic = "force-dynamic";

const CONFIRM = staffVerifyHref("/staff/two-step?confirm=1", AUTHORITY_REQUESTS_PATH);

export default async function AuthorityRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ closed?: string | string[] }>;
}) {
  await requireStaff("identity:disclose");
  let items: DisclosureListItem[];
  try {
    const { api } = await readFoundationServerSession();
    items = await listIdentityDisclosures(api);
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired) redirect(CONFIRM);
    createLogger("AuthorityRequestsPage").error("Authority requests read failed");
    return (
      <div className="space-y-6">
        <Header />
        <p role="alert">Authority requests could not be loaded. Refresh to try again.</p>
      </div>
    );
  }
  const closed = (await searchParams)?.closed === "1";
  const authenticatorAt = await readStaffAuthenticatorHint();
  const left =
    authenticatorAt === null
      ? null
      : minutesLeft((authenticatorAt + DISCLOSURE_OPEN_MINUTES * 60) * 1000);
  // The list is read with the same 15-minute rule, so a code is fresh here.
  const ago = left === null ? null : DISCLOSURE_OPEN_MINUTES - left;
  return (
    <div className="space-y-6">
      <Header />
      {closed && (
        <p role="status" className="max-w-4xl rounded-2xl border bg-muted/60 p-4 text-sm">
          <strong className="font-semibold">The record closed.</strong> Records close 15 minutes
          after they are opened. Opening it again is logged again.
        </p>
      )}
      <div
        role="status"
        className="flex max-w-4xl items-start gap-3 rounded-2xl border border-brand-green-200 bg-brand-green-50 p-4 text-sm text-brand-green-900"
      >
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          {left !== null && ago !== null ? (
            <>
              <strong className="font-semibold">
                2-step check done{" "}
                {ago < 1 ? "just now" : `${ago} minute${ago === 1 ? "" : "s"} ago`}.
              </strong>{" "}
              You can open a record for {left} more minute{left === 1 ? "" : "s"}, then you&apos;ll
              be asked again.
            </>
          ) : (
            <>
              <strong className="font-semibold">2-step check needed.</strong> Opening a record needs
              a 2-step check from the last 15 minutes; you&apos;ll be asked again when it is older.
            </>
          )}
        </p>
      </div>
      <AuthorityRequestForm />
      <EarlierRequests items={items} />
    </div>
  );
}

function Header() {
  return (
    <PageHeader
      title="Authority requests"
      description="Open a member's kept identity record to answer a police or court request. Admins and governors only. Every opening is logged."
      breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Authority requests" }]}
    />
  );
}

function EarlierRequests({ items }: { items: DisclosureListItem[] }) {
  return (
    <Card className="max-w-4xl">
      <h2 className="px-4 pb-3 pt-4 font-display text-lg font-semibold sm:px-5">
        Earlier requests
      </h2>
      {items.length === 0 ? (
        <p className="border-t px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">
          No record has been opened yet. Every opening will be listed here.
        </p>
      ) : (
        <ul className="divide-y border-t">
          {items.map((item) => {
            const status = earlierRequestStatus(item);
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="break-words text-sm font-semibold text-foreground">
                    {item.reference}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {disclosureNumber(item.number)} · {formatDate(item.opened_at)} · opened by{" "}
                    {item.opened_by_name ?? "a staff member"}
                  </p>
                </div>
                {item.open && (
                  <Link
                    href={`${AUTHORITY_REQUESTS_PATH}/${item.id}`}
                    className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium text-primary underline underline-offset-4 sm:h-9"
                  >
                    Back to the record
                  </Link>
                )}
                <Badge variant={status.tone === "success" ? "live" : "draft"}>{status.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
