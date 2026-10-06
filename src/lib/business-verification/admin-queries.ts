import { suggestNextStep, type Finding } from "@/lib/cipc/screen";
import { createAdminClient } from "@/lib/supabase/admin";

import { approvalEvidence, type AdminCopy } from "./decide";
import type { StoredParse } from "./intake";

export const QUEUE_TABS = [
  { key: "review", label: "CIPC" },
  { key: "representatives", label: "Representatives" },
  { key: "visits", label: "Visits" },
  { key: "conflicts", label: "Conflicts" },
  { key: "renewals", label: "Renewals" },
  { key: "exceptions", label: "Second review" },
  { key: "waiting", label: "Waiting on owner" },
  { key: "decided", label: "Decided" },
] as const;
export type QueueTab = (typeof QUEUE_TABS)[number]["key"];

export type QueueRow = {
  id: string;
  kind: string;
  route: string | null;
  status: string;
  businessId: string;
  businessName: string;
  ownerName: string;
  registrationNumber: string | null;
  red: number;
  amber: number;
  createdAt: string;
  updatedAt: string;
  exceptionPending: boolean;
  conflict: boolean;
  renewal: boolean;
};

type RawCase = {
  id: string;
  kind: string;
  route: string | null;
  status: string;
  business_id: string;
  owner_id: string;
  registration_number: string | null;
  findings: Finding[] | null;
  checks: { exception?: { proposedBy?: string; confirmedBy?: string } } | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
};

function inTab(row: QueueRow, tab: QueueTab): boolean {
  const open = row.status === "pending";
  switch (tab) {
    case "review":
      return (
        open &&
        row.kind !== "seen" &&
        row.route !== "representative" &&
        !row.conflict &&
        !row.renewal &&
        !row.exceptionPending
      );
    case "representatives":
      return open && row.route === "representative" && !row.exceptionPending;
    case "visits":
      return open && row.kind === "seen";
    case "conflicts":
      return open && row.conflict;
    case "renewals":
      return (
        open &&
        row.renewal &&
        row.route !== "representative" &&
        !row.conflict &&
        !row.exceptionPending
      );
    case "exceptions":
      return open && row.exceptionPending;
    case "waiting":
      return row.status === "info_requested";
    case "decided":
      return !["pending", "info_requested"].includes(row.status);
  }
}

export async function listQueue(tab: QueueTab, includeIds: string[] = []) {
  const admin = createAdminClient();
  const decided = tab === "decided";
  let query = admin
    .from("business_verifications")
    .select(
      "id, kind, route, status, business_id, owner_id, registration_number, findings, checks, created_at, updated_at, decided_at"
    )
    .limit(200);
  query = decided
    ? query
        .not("status", "in", "(pending,info_requested)")
        .order("decided_at", { ascending: false })
    : query.in("status", ["pending", "info_requested"]).order("created_at", { ascending: true });
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const raw = (data ?? []) as RawCase[];

  const businessIds = [...new Set(raw.map((r) => r.business_id))];
  const ownerIds = [...new Set(raw.map((r) => r.owner_id))];
  const [{ data: businesses }, { data: owners }] = await Promise.all([
    businessIds.length
      ? admin.from("businesses").select("id, business_name").in("id", businessIds)
      : Promise.resolve({ data: [] as Array<{ id: string; business_name: string }> }),
    ownerIds.length
      ? admin.from("account_profiles").select("user_id, display_name").in("user_id", ownerIds)
      : Promise.resolve({ data: [] as Array<{ user_id: string; display_name: string | null }> }),
  ]);
  const bizName = new Map((businesses ?? []).map((b) => [b.id, b.business_name as string]));
  const ownerName = new Map(
    (owners ?? []).map((o) => [o.user_id, (o.display_name as string) || "Member"])
  );

  const rows: QueueRow[] = raw.map((r) => {
    const findings = r.findings ?? [];
    const exception = r.checks?.exception;
    return {
      id: r.id,
      kind: r.kind,
      route: r.route,
      status: r.status,
      businessId: r.business_id,
      businessName: bizName.get(r.business_id) ?? "Business",
      ownerName: ownerName.get(r.owner_id) ?? "Member",
      registrationNumber: r.registration_number,
      red: findings.filter((f) => f.severity === "attention").length,
      amber: findings.filter((f) => f.severity === "check").length,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      exceptionPending: Boolean(exception?.proposedBy && !exception.confirmedBy),
      conflict: findings.some((f) => f.code === "conflict_other_owner"),
      // The renew route marks one-tap renewals (no new upload).
      renewal: findings.some((f) => f.code === "renewal"),
    };
  });

  const counts = Object.fromEntries(
    QUEUE_TABS.map((t) => [
      t.key,
      t.key === "decided" ? null : rows.filter((r) => inTab(r, t.key)).length,
    ])
  ) as Record<QueueTab, number | null>;
  const include = new Set(includeIds);
  const shown = rows
    .filter((r) => inTab(r, tab) || (!decided && include.has(r.id)))
    .sort((a, b) => (decided ? 0 : b.red - a.red || a.createdAt.localeCompare(b.createdAt)));
  return { rows: shown, counts };
}

export type CaseDetail = Awaited<ReturnType<typeof getCaseDetail>>;

export async function getCaseDetail(caseId: string) {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("business_verifications")
    .select("*")
    .eq("id", caseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;

  const [bizRes, ownerRes, filesRes, messagesRes, accessRes, stepRes] = await Promise.all([
    admin
      .from("businesses")
      .select(
        "id, business_name, slug, status, location_city, location_province, cipc_verified_at, cipc_registration_number"
      )
      .eq("id", row.business_id)
      .maybeSingle(),
    admin
      .from("account_profiles")
      .select("display_name, legal_first_name, legal_last_name, account_verification_status")
      .eq("user_id", row.owner_id)
      .maybeSingle(),
    admin
      .from("business_verification_files")
      .select(
        "id, kind, content_type, size_bytes, producer, revision_count, quarantined, created_at, purged_at"
      )
      .eq("case_id", caseId)
      .order("created_at", { ascending: true }),
    admin
      .from("business_verification_messages")
      .select("id, author_role, author_id, body, attachment_file_id, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true }),
    admin
      .from("business_verification_evidence_access_logs")
      .select("actor_id, action, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("verification_steps")
      .select("id_number_hmac")
      .eq("user_id", row.owner_id)
      .eq("step_type", "id_doc")
      .eq("status", "approved")
      .maybeSingle(),
  ]);

  const parsed = (row.parsed ?? {}) as Partial<StoredParse>;
  const adminCopy = (row.admin_copy ?? null) as AdminCopy | null;
  const ownerHmac = (stepRes.data?.id_number_hmac as string | null) ?? null;
  const findings = (row.findings ?? []) as Finding[];
  const evidence = row.kind === "seen" ? null : await approvalEvidence(admin, row);
  const matchName = (directors: Array<{ name: string; idHmac: string | null }> | undefined) =>
    ownerHmac ? (directors?.find((d) => d.idHmac === ownerHmac)?.name ?? null) : null;

  return {
    id: row.id as string,
    kind: row.kind as "cipc" | "cipc_link" | "seen",
    route: row.route as string | null,
    status: row.status as string,
    updatedAt: row.updated_at as string,
    createdAt: row.created_at as string,
    decidedAt: row.decided_at as string | null,
    expiresAt: row.expires_at as string | null,
    reasonCode: row.reason_code as string | null,
    reviewNote: row.review_note as string | null,
    registrationNumber: row.registration_number as string | null,
    docType: row.doc_type as string | null,
    ownerId: row.owner_id as string,
    business: bizRes.data,
    owner: {
      displayName: (ownerRes.data?.display_name as string | null) ?? null,
      legalName:
        [ownerRes.data?.legal_first_name, ownerRes.data?.legal_last_name]
          .filter(Boolean)
          .join(" ") || null,
      idReviewed: ownerRes.data?.account_verification_status === "verified",
      hasIdHash: Boolean(ownerHmac),
    },
    parsed: {
      registeredName: parsed.registeredName ?? null,
      registrationNumber: parsed.registrationNumber ?? null,
      enterpriseStatus: parsed.enterpriseStatus ?? null,
      issuedOn: parsed.issuedOn ?? null,
      registeredOfficeLines: parsed.registeredOfficeLines ?? [],
      directors: (parsed.directors ?? []).map((d) => ({
        name: d.name,
        role: d.role,
        hasSaId: d.hasSaId,
        isOwner: Boolean(ownerHmac && d.idHmac === ownerHmac),
      })),
    },
    ownerMatchOnUpload: matchName(parsed.directors),
    adminCopy: adminCopy
      ? {
          ...adminCopy,
          directors: adminCopy.directors.map((d) => ({
            name: d.name,
            role: d.role,
            isOwner: Boolean(ownerHmac && d.idHmac === ownerHmac),
          })),
        }
      : null,
    registeredOffice: row.registered_office as Record<string, unknown> | null,
    // The work-email code hash never leaves the server.
    representative: row.representative
      ? (({ codeHash: _codeHash, ...rest }) => rest)(row.representative as Record<string, unknown>)
      : null,
    seen: row.seen as Record<string, unknown> | null,
    checks: row.checks as {
      exception?: { proposedBy?: string; reason?: string; confirmedBy?: string };
    } | null,
    findings,
    suggestion: suggestNextStep(findings, Boolean(adminCopy)),
    evidence,
    files: filesRes.data ?? [],
    messages: messagesRes.data ?? [],
    accessLog: accessRes.data ?? [],
  };
}
