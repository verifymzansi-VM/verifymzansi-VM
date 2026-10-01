import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCapabilityRoleFromDb } from "@/lib/auth/admin-access";
import { checkStaffApiMfa } from "@/lib/auth/staff-mfa-guard";
import { parsePerformanceReport } from "@/components/organisations/performance-report";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("OrganisationReportCsv");
const DAY = 86_400_000;

/** Quote a CSV cell and neutralise spreadsheet formulas (=, +, -, @). */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const row = (...cells: unknown[]) => cells.map(csvCell).join(",");

interface MemberRow {
  business_name: string;
  category: string | null;
  city: string | null;
  business_status: string;
  confirmed_at: string;
  sponsorship_status: string | null;
  sponsorship_ends_at: string | null;
}

/**
 * GET /api/organisations/:id/report?days=30 | ?from=YYYY-MM-DD
 * The programme activity report as CSV: aggregate views and clicks, then the
 * businesses that consented to join (no identity or viewer data).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (checkLocalRateLimit(user.id, "organisation:report-csv", 20).limited) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const db = createAdminClient();
  const { data: isAdmin } = await db.rpc("is_organisation_admin", { p_org: id, p_user: user.id });
  if (isAdmin !== true) {
    // Not an administrator of this programme: only staff, under the staff MFA policy.
    if (!(await verifyCapabilityRoleFromDb(user, "organisations:manage"))) {
      return NextResponse.json({ error: "Organisation access required" }, { status: 403 });
    }
    const mfaBlock = await checkStaffApiMfa(supabase, user.id);
    if (mfaBlock) return mfaBlock;
  }

  const { data: org } = await db
    .from("organisations")
    .select("name, slug, trial_starts_at")
    .eq("id", id)
    .maybeSingle();
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const params = request.nextUrl.searchParams;
  const days = Number.parseInt(params.get("days") ?? "", 10);
  const fromParam = params.get("from");
  const from =
    Number.isInteger(days) && days >= 1 && days <= 366
      ? new Date(now.getTime() - days * DAY)
      : fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)
        ? new Date(`${fromParam}T00:00:00+02:00`)
        : org.trial_starts_at
          ? new Date(org.trial_starts_at)
          : new Date(now.getTime() - 90 * DAY);
  if (Number.isNaN(from.getTime()) || from > now) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  const [report, members] = await Promise.all([
    db.rpc("organisation_performance_report", {
      p_user: user.id,
      p_org: id,
      p_from: from.toISOString(),
      p_to: now.toISOString(),
    }),
    db.rpc("org_list_members", { p_user: user.id, p_org: id }),
  ]);
  if (report.error || members.error) {
    log.error("Report export failed", { code: report.error?.code ?? members.error?.code });
    return NextResponse.json({ error: "The report could not be generated." }, { status: 503 });
  }
  const r = parsePerformanceReport(report.data);
  if (!r)
    return NextResponse.json({ error: "The report could not be generated." }, { status: 503 });

  const lines = [
    row("VerifyMzansi programme activity report"),
    row("Programme", org.name),
    row("Period from", from.toISOString()),
    row("Period to", now.toISOString()),
    row(
      "Limitations",
      "Views and clicks on VerifyMzansi only. A contact click is not a confirmed enquiry or sale. Visitors who block tracking are not counted."
    ),
    "",
    row("Metric", "Value"),
    row("Participating businesses", r.participatingBusinesses),
    row("Live businesses", r.activeBusinesses),
    row("Supported places in use", r.sponsoredBusinesses),
    row("Listings and posts", r.totalListings),
    row("Profile views", r.profileViews),
    row("Unique contact clicks: WhatsApp", r.events.whatsapp_click ?? 0),
    row("Unique contact clicks: phone", r.events.phone_click ?? 0),
    row("Website clicks", r.events.website_click ?? 0),
    row("Partner logo views (strip, home, index)", r.sponsorVisibility.impressions),
    row("Clicks to the programme showcase", r.sponsorVisibility.clicks),
    row("Showcase page visits", r.sponsorVisibility.pageViews),
    "",
    row("Business", "Category", "City", "Status", "Joined", "Supported place", "Supported until"),
    ...((members.data ?? []) as MemberRow[]).map((m) =>
      row(
        m.business_name,
        (m.category ?? "").replace(/_/g, " "),
        m.city,
        m.business_status,
        m.confirmed_at?.slice(0, 10),
        m.sponsorship_status ?? "",
        m.sponsorship_ends_at?.slice(0, 10) ?? ""
      )
    ),
  ];

  const filename = `${org.slug}-activity-${from.toISOString().slice(0, 10)}-to-${now
    .toISOString()
    .slice(0, 10)}.csv`;
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
