import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { requireStaff } from "@/lib/auth/require-staff";
import { STAFF_MFA_PATH } from "@/lib/auth/staff-mfa";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import {
  readFoundationStaffAudit,
  FoundationStaffReadError,
  type FoundationAuditPage,
} from "@/lib/foundation/staff-read";
import { formatSaLongDate } from "@/lib/utils/format";

type Query = Record<string, string | string[] | undefined>;
const filters = ["action", "actor", "target", "from", "to", "q"] as const;
const label = (value: string) =>
  value.replace(/[_:]/g, " ").replace(/^./, (letter) => letter.toUpperCase());

export async function FoundationStaffAuditPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireStaff("audit:view");
  const current = await readFoundationServerSession();
  const query = await searchParams;
  const input: Record<string, unknown> = { limit: 50 };
  for (const name of [...filters, "before_at", "before_id"]) {
    const value = query[name];
    if (value !== undefined && value !== "") input[name] = value;
  }
  let page: FoundationAuditPage | null = null;
  let message: string | null = null;
  try {
    page = await readFoundationStaffAudit(current.api, input);
  } catch (error) {
    if (!(error instanceof FoundationStaffReadError)) throw error;
    if (error.mfaRequired)
      redirect(`${STAFF_MFA_PATH}?confirm=1&next=${encodeURIComponent("/admin/audit-log")}`);
    message = error.message;
  }
  const first = new URLSearchParams();
  for (const name of filters)
    if (typeof query[name] === "string" && query[name]) first.set(name, query[name]);
  const older = new URLSearchParams(first);
  if (page?.next_cursor)
    for (const [name, value] of Object.entries(page.next_cursor)) older.set(name, value);
  const field = (name: string) => (typeof query[name] === "string" ? query[name] : "");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Recorded staff actions and access to case evidence."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Audit log" }]}
      />
      <form method="get" className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
        {[
          ["action", "Action prefix"],
          ["actor", "Staff / actor ID"],
          ["target", "Target ID"],
          ["from", "From date (SAST)"],
          ["to", "To date (SAST)"],
          ["q", "Reason contains"],
        ].map(([name, title]) => (
          <label key={name} className="text-sm">
            {title}
            <input
              name={name}
              type={name === "from" || name === "to" ? "date" : "text"}
              defaultValue={field(name)}
              maxLength={name === "q" ? 100 : 150}
              className="mt-1 h-10 w-full rounded-md border bg-background px-3"
            />
          </label>
        ))}
        <div className="flex items-end gap-4 sm:col-span-3">
          <button className="rounded-md bg-primary px-5 py-2 font-semibold text-primary-foreground">
            Filter events
          </button>
          <Link href="/admin/audit-log" className="underline">
            Clear filters
          </Link>
        </div>
      </form>
      {message ? (
        <p role="alert" className="rounded-lg border border-destructive p-4">
          {message}
        </p>
      ) : (
        page && (
          <>
            <p className="text-sm text-muted-foreground">{page.items.length} events on this page</p>
            {page.items.length ? (
              <ol className="divide-y rounded-lg border">
                {page.items.map((event) => (
                  <li key={event.id} className="space-y-2 p-4">
                    <div className="flex flex-wrap justify-between gap-2">
                      <h2 className="font-semibold">{label(event.action)}</h2>
                      <time dateTime={event.occurred_at} className="text-sm text-muted-foreground">
                        {formatSaLongDate(event.occurred_at)} SAST
                      </time>
                    </div>
                    <p className="text-sm">
                      {event.actor_id ? (
                        <>
                          Staff: {event.actor_name ?? event.actor_id}
                          <span className="ml-2 break-all text-xs text-muted-foreground">
                            {event.actor_name ? event.actor_id : ""}
                          </span>
                        </>
                      ) : (
                        "System / operator"
                      )}
                    </p>
                    {event.target_id && (
                      <p className="break-all text-sm">
                        {label(event.target_type)}: <code>{event.target_id}</code>
                      </p>
                    )}
                    {event.reason && (
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {event.reason}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border p-6">No recorded events match these filters.</p>
            )}
            <nav className="flex gap-6" aria-label="Audit log pages">
              {query.before_at && (
                <Link className="underline" href={`/admin/audit-log?${first}`}>
                  Newest events
                </Link>
              )}
              {page.next_cursor && (
                <Link className="underline" href={`/admin/audit-log?${older}`}>
                  Older events
                </Link>
              )}
            </nav>
          </>
        )
      )}
    </div>
  );
}
