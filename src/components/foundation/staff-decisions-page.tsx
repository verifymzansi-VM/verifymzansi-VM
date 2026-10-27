import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/require-staff";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import {
  FoundationStaffReadError,
  readFoundationStaffDecisions,
} from "@/lib/foundation/staff-read";
import { formatSaLongDate } from "@/lib/utils/format";

const base = "/admin/governance/escalations";
type Filters = Record<string, string | string[] | undefined>;

/** Decision metadata never substitutes for the lease-bound evidence review. */
export async function FoundationStaffDecisionsPage({
  searchParams,
  id,
}: {
  searchParams?: Promise<Filters>;
  id?: string;
}) {
  const staff = await requireStaff("decision:approve");
  const canReviewIdentity = ["case:claim", "evidence:view"].every((capability) =>
    staff.assignedCapabilities?.includes(capability)
  );
  const { api, user } = await readFoundationServerSession();
  const query = await (searchParams ?? Promise.resolve({} as Filters));
  const input: Record<string, unknown> = { limit: id ? 1 : 50, status: "all" };
  if (id) input.id = id;
  else
    for (const name of ["status", "action", "case_id", "before_at", "before_id"]) {
      if (query[name] !== undefined && query[name] !== "") input[name] = query[name];
    }
  let result: Awaited<ReturnType<typeof readFoundationStaffDecisions>>;
  try {
    result = await readFoundationStaffDecisions(api, user.id, input);
  } catch (error) {
    if (!(error instanceof FoundationStaffReadError)) throw error;
    if (error.mfaRequired)
      redirect(`/staff/two-step?confirm=1&next=${encodeURIComponent(id ? `${base}/${id}` : base)}`);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Governance decisions</h1>
        <p role="alert">{error.message}</p>
        <Link href={base}>Back to decisions</Link>
      </div>
    );
  }
  if (id && !result.items.length) notFound();
  const older = new URLSearchParams();
  for (const key of ["status", "action", "case_id"])
    if (typeof query[key] === "string" && query[key]) older.set(key, query[key]);
  if (result.next_cursor) {
    older.set("before_at", result.next_cursor.before_at);
    older.set("before_id", result.next_cursor.before_id);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{id ? "Governance decision" : "Governance decisions"}</h1>
      <p>
        Inspect the case and its current evidence before making an independent decision. A proposal
        is not an approval.
      </p>
      {!id && (
        <form method="get" className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
          <label>
            Status
            <select
              name="status"
              defaultValue={typeof query.status === "string" ? query.status : "all"}
              className="ml-2 rounded border bg-background p-2"
            >
              {["all", "proposed", "approved", "withdrawn"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Case ID
            <input
              name="case_id"
              defaultValue={typeof query.case_id === "string" ? query.case_id : ""}
              className="ml-2 rounded border bg-background p-2"
              maxLength={36}
            />
          </label>
          <button className="rounded border px-4 py-2">Filter decisions</button>
          <Link href={base} className="underline">
            Clear filters
          </Link>
        </form>
      )}
      {!result.items.length && <p>No decisions match these filters.</p>}
      {result.items.map((row) => (
        <article key={row.id} className="space-y-3 rounded-lg border p-5">
          <h2 className="font-semibold">
            <Link href={`${base}/${row.id}`} className="underline">
              {row.action.replaceAll("_", " ")}
            </Link>{" "}
            · {row.status}
          </h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              ["Decision ID", row.id],
              ["Case", `${row.case_kind}: ${row.case_id}`],
              ["Account", row.subject_id],
              ["Proposed by", row.proposed_by],
              ["Proposed at", `${formatSaLongDate(row.proposed_at)} SAST`],
              ["Case version", `${row.case_version} (current: ${row.current_case_version})`],
              ...(row.approved_by
                ? [
                    ["Approved by", row.approved_by],
                    ["Approved at", `${formatSaLongDate(row.approved_at!)} SAST`],
                  ]
                : []),
              ...(row.withdrawn_by
                ? [
                    ["Withdrawn by", row.withdrawn_by],
                    ["Withdrawal reason", row.withdrawal_reason ?? ""],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-words whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
          </dl>
          {row.status === "proposed" && (
            <p className="text-sm">
              {row.proposed_by === user.id
                ? "You proposed this decision. An independent reviewer must approve it."
                : row.subject_id === user.id
                  ? "You cannot approve a decision about your own account."
                  : row.case_version !== row.current_case_version
                    ? "The case changed after this proposal. Review its current version."
                    : "Review the current case before approving this proposal."}
            </p>
          )}
          {canReviewIdentity && row.case_kind === "kyc" && row.status === "proposed" && (
            <Link href="/admin/verification/evidence" className="inline-block underline">
              Open identity review desk
            </Link>
          )}
        </article>
      ))}
      <nav aria-label="Decision pages" className="flex gap-5">
        <Link href={base} className="underline">
          All decisions
        </Link>
        {!id && result.next_cursor && (
          <Link href={`${base}?${older}`} className="underline">
            Older decisions
          </Link>
        )}
      </nav>
    </div>
  );
}
