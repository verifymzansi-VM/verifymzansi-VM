import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ShieldAlert,
  Users,
  Package,
  Flag,
  FileCheck,
  UserX,
  Clock,
  TrendingUp,
  Store,
  Briefcase,
  ShoppingBag,
  UserCheck,
  Ban,
  Phone,
  CreditCard,
  Camera,
  MapPin,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/layout/page-header";
import { ActivityFeedCard } from "@/components/admin/activity-feed";
import { DashboardKycPanel } from "@/components/admin/dashboard-kyc-panel";
import { DashboardReportsPanel } from "@/components/admin/dashboard-reports-panel";
import { ModerationQueueClient } from "@/app/admin/moderation/moderation-queue-client";
import { getRoleFromUser, isModeratorOrAdmin } from "@/lib/auth/roles";
import {
  getAdminDashboardStats,
  getDashboardKycQueue,
  getDashboardReports,
  getDashboardContentQueue,
  getRecentActivity,
  getActionsToday,
  getVerificationStepCounts,
  getExtendedPlatformStats,
  getAreaCardCounts,
} from "@/lib/utils/admin-queries";

export const metadata = {
  title: "Admin Dashboard | VerifyMzansi",
};

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = getRoleFromUser(user);
  if (!isModeratorOrAdmin(user) || !role) redirect("/dashboard");

  const [
    stats,
    kycQueue,
    reports,
    contentQueue,
    activity,
    actionsToday,
    stepCounts,
    extended,
    areaCounts,
  ] = await Promise.all([
    getAdminDashboardStats(),
    getDashboardKycQueue(50),
    getDashboardReports(30),
    getDashboardContentQueue(),
    getRecentActivity(20),
    getActionsToday(),
    getVerificationStepCounts(),
    getExtendedPlatformStats(),
    getAreaCardCounts(),
  ]);

  const totalActions = Object.values(actionsToday).reduce((a, b) => a + b, 0);
  const actionEntries = Object.entries(actionsToday).filter(([, v]) => v > 0);

  const highReports = reports.filter((r) => r.severity === "high");
  const verifiedPct =
    stats.totalSellers > 0 ? Math.round((extended.verifiedSellers / stats.totalSellers) * 100) : 0;

  // Critical alerts: high-severity reports, large KYC backlog, large moderation backlog
  const alerts: string[] = [];
  if (highReports.length > 0)
    alerts.push(
      `${highReports.length} high-severity report${highReports.length > 1 ? "s" : ""} need${highReports.length === 1 ? "s" : ""} urgent review`
    );
  if (kycQueue.length >= 30)
    alerts.push(`${kycQueue.length} KYC submissions queued — consider prioritising the backlog`);
  if (stats.pendingModeration >= 20)
    alerts.push(`${stats.pendingModeration} content items are awaiting first-time approval`);

  return (
    <div className="space-y-6">
      {/* ── CRITICAL ALERTS ──────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 space-y-1">
          <p className="text-sm font-semibold text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Requires Immediate Attention
          </p>
          {alerts.map((alert, i) => (
            <p key={i} className="text-sm text-destructive/90 pl-6">
              • {alert}
            </p>
          ))}
        </div>
      )}

      <PageHeader title="Admin Dashboard">
        <div className="flex items-center gap-2">
          <Badge variant="destructive">{role === "admin" ? "Admin" : "Moderator"}</Badge>
        </div>
      </PageHeader>

      {/* ── NEEDS ATTENTION ──────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>Needs Attention</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={FileCheck}
            label="Pending KYC"
            value={stats.pendingVerifications}
            color="amber"
            href="/admin/verification"
            description="Identity submissions awaiting review"
          />
          <StatCard
            icon={Flag}
            label="Open Reports"
            value={stats.openReports}
            color="destructive"
            href="/admin/reports"
            description={
              highReports.length > 0
                ? `${highReports.length} high-severity`
                : "No high-severity reports"
            }
          />
          <StatCard
            icon={Clock}
            label="Awaiting Approval"
            value={stats.pendingModeration}
            color="amber"
            href="/admin/moderation"
            description="New content pending first-time review"
          />
        </div>
      </section>

      {/* ── PLATFORM OVERVIEW ────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>Platform Overview</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            icon={Users}
            label="Total Sellers"
            value={stats.totalSellers}
            color="primary"
            description={`${verifiedPct}% verified`}
          />
          <StatCard
            icon={UserCheck}
            label="Verified Sellers"
            value={extended.verifiedSellers}
            color="primary"
            description="Passed all 4 KYC steps"
          />
          <StatCard
            icon={UserX}
            label="Suspended"
            value={stats.activeSuspensions}
            color={stats.activeSuspensions > 0 ? "destructive" : "primary"}
            description="Active account suspensions"
          />
          <StatCard
            icon={Ban}
            label="Banned"
            value={extended.bannedSellers}
            color={extended.bannedSellers > 0 ? "destructive" : "primary"}
            description="Permanently banned accounts"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={Package}
            label="Total Listings"
            value={stats.totalListings}
            color="primary"
            description="All time across all areas"
          />
          <StatCard
            icon={TrendingUp}
            label="Live Listings"
            value={extended.liveListings}
            color="primary"
            description="Currently visible to buyers"
          />
          <StatCard
            icon={ShieldAlert}
            label="Hidden Listings"
            value={extended.hiddenListings}
            color={extended.hiddenListings > 0 ? "amber" : "primary"}
            description="Removed from public view"
          />
        </div>
      </section>

      {/* ── VERIFICATION STEP BREAKDOWN ──────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>Verification Backlog by Step</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StepCard icon={CreditCard} label="ID Document" count={stepCounts.id_doc} />
          <StepCard icon={Camera} label="Selfie" count={stepCounts.selfie} />
          <StepCard icon={MapPin} label="Location" count={stepCounts.location} />
          <StepCard icon={Phone} label="Phone" count={stepCounts.phone} />
        </div>
      </section>

      {/* ── KYC VERIFICATION QUEUE ───────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionHeading>
            KYC Verification Queue
            {kycQueue.length > 0 && (
              <Badge variant="destructive" className="ml-2 text-[10px]">
                {kycQueue.length}
              </Badge>
            )}
          </SectionHeading>
          <Link href="/admin/verification" className="text-xs text-primary hover:underline">
            Full queue →
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          Review each seller&apos;s identity submission. For selfie steps, compare against their ID
          document. Oldest submissions shown first. Cards highlighted in amber have been waiting
          more than 24 hours.
        </p>
        <DashboardKycPanel initialItems={kycQueue} stepCounts={stepCounts} />
      </section>

      {/* ── CONTENT + REPORTS SIDE BY SIDE ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeading>
              Content Awaiting Approval
              {contentQueue.length > 0 && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {contentQueue.length}
                </Badge>
              )}
            </SectionHeading>
            <Link href="/admin/moderation" className="text-xs text-primary hover:underline">
              Full queue →
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            New listings, storefronts, and business profiles waiting for first-time approval before
            going live.
          </p>
          <ModerationQueueClient
            items={contentQueue.map((i) => ({
              ...i,
              category: i.category ?? undefined,
              seller_id: i.seller_id ?? undefined,
            }))}
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeading>
              Open Reports
              {reports.length > 0 && (
                <Badge variant="destructive" className="ml-2 text-[10px]">
                  {reports.length}
                </Badge>
              )}
            </SectionHeading>
            <Link href="/admin/reports" className="text-xs text-primary hover:underline">
              Full queue →
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Sorted by severity then age. High-severity SLA is 4 hours; standard is 24 hours.
          </p>
          <DashboardReportsPanel reports={reports} />
        </section>
      </div>

      {/* ── MARKETPLACE AREA BREAKDOWN ───────────────────────── */}
      <section className="space-y-3">
        <SectionHeading>Marketplace Areas</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <AreaCard
            icon={ShoppingBag}
            label="Mzansi Market"
            href="/admin/mzansi-market"
            pendingFlags={areaCounts.MZANSI_MARKET.pendingFlags}
            pendingContent={areaCounts.MZANSI_MARKET.pendingContent}
          />
          <AreaCard
            icon={Briefcase}
            label="Business Ads"
            href="/admin/business-ads"
            pendingFlags={areaCounts.BUSINESS_ADS.pendingFlags}
            pendingContent={areaCounts.BUSINESS_ADS.pendingContent}
          />
          <AreaCard
            icon={Store}
            label="Mall Shops"
            href="/admin/mall-shops"
            pendingFlags={areaCounts.MALL_SHOPS.pendingFlags}
            pendingContent={areaCounts.MALL_SHOPS.pendingContent}
          />
        </div>
      </section>

      {/* ── ACTIONS TODAY + RECENT ACTIVITY ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3 pt-5">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              Actions Today
            </h3>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {totalActions === 0 ? (
              <p className="text-sm text-muted-foreground">No actions taken yet today.</p>
            ) : (
              <>
                {actionEntries.map(([action, count]) => (
                  <div key={action} className="flex justify-between text-sm">
                    <span className="text-muted-foreground capitalize">
                      {action.replace(/_/g, " ")}
                    </span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between text-sm font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{totalActions}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <ActivityFeedCard entries={activity} title="Recent Activity" />
        </div>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center">
      {children}
    </h2>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  href,
  description,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  color: string;
  href?: string;
  description?: string;
}) {
  const content = (
    <Card className={href ? "hover:bg-muted/50 transition-colors cursor-pointer h-full" : "h-full"}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div
            className={`inline-flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 ${
              color === "destructive"
                ? "bg-destructive/10 text-destructive"
                : color === "amber"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                  : "bg-primary/10 text-primary"
            }`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-bold font-display tabular-nums">{value}</p>
            <p className="text-xs font-medium text-foreground">{label}</p>
            {description && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (href) return <Link href={href}>{content}</Link>;
  return content;
}

function StepCard({
  icon: Icon,
  label,
  count,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-muted flex-shrink-0">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xl font-bold tabular-nums">{count}</p>
            <p className="text-xs text-muted-foreground truncate">{label}</p>
          </div>
          {count > 0 && <span className="h-2 w-2 rounded-full bg-amber-500 flex-shrink-0" />}
        </div>
      </CardContent>
    </Card>
  );
}

function AreaCard({
  icon: Icon,
  label,
  href,
  pendingFlags,
  pendingContent,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  pendingFlags: number;
  pendingContent: number;
}) {
  const hasIssues = pendingFlags > 0 || pendingContent > 0;
  return (
    <Link href={href}>
      <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm font-semibold">{label}</span>
            {hasIssues && (
              <span className="ml-auto h-2 w-2 rounded-full bg-destructive flex-shrink-0" />
            )}
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pending flags</span>
              <span
                className={`font-medium tabular-nums ${pendingFlags > 0 ? "text-destructive" : ""}`}
              >
                {pendingFlags}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Awaiting approval</span>
              <span
                className={`font-medium tabular-nums ${pendingContent > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}
              >
                {pendingContent}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
