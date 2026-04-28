"use client";

import { Clock, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrustBadge } from "@/components/trust/trust-badge";
import { ShareButton } from "@/components/shared/share-button";
import { ReportDialog } from "@/components/shared/report-dialog";
import type {
  BusinessDetailRecord,
  BusinessOwnerRecord,
} from "@/components/business/business-detail-content";
import type { TrustLevel } from "@/types/enums";

/* ── Operating Hours Card ─────────────────────────────── */

interface OperatingHoursCardProps {
  operatingHours: Record<string, string>;
}

export function OperatingHoursCard({ operatingHours }: OperatingHoursCardProps) {
  if (!operatingHours || Object.keys(operatingHours).length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Operating Hours
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {operatingHours.Mon_Fri && (
            <div className="flex items-center justify-between py-1">
              <dt className="text-muted-foreground">Mon - Fri</dt>
              <dd className="font-medium">{operatingHours.Mon_Fri}</dd>
            </div>
          )}
          {operatingHours.Sat && (
            <div className="flex items-center justify-between border-t py-1">
              <dt className="text-muted-foreground">Saturday</dt>
              <dd className="font-medium">{operatingHours.Sat}</dd>
            </div>
          )}
          {operatingHours.Sun && (
            <div className="flex items-center justify-between border-t py-1">
              <dt className="text-muted-foreground">Sunday / Holidays</dt>
              <dd className="font-medium">{operatingHours.Sun}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

/* ── Managed By Card ──────────────────────────────────── */

interface ManagedByCardProps {
  ownerProfile: BusinessOwnerRecord | null;
  trustLevel: TrustLevel | null;
}

export function ManagedByCard({ ownerProfile, trustLevel }: ManagedByCardProps) {
  const reviewRows = [
    { label: "Owner-claimed", value: "No" },
    { label: "Official representative reviewed", value: "No" },
    { label: "Information supplied by", value: "Poster" },
    { label: "Last reviewed date", value: "Not publicly displayed" },
  ] as const;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Posted By
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">{ownerProfile?.display_name || "Reviewed Representative"}</p>
            {trustLevel != null && <TrustBadge level={trustLevel} size="sm" />}
            <p className="mt-1 text-xs text-muted-foreground">Person-level verification only.</p>
          </div>
        </div>
        <dl className="grid gap-2 text-xs">
          {reviewRows.map((row) => (
            <div key={row.label} className="rounded-lg border bg-muted/30 px-3 py-2">
              <dt className="font-medium text-foreground">{row.label}</dt>
              <dd className="mt-0.5 text-muted-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex gap-2">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Official business ownership is not confirmed unless this page explicitly says an
              official representative was reviewed.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Share & Report Row ───────────────────────────────── */

interface ShareReportRowProps {
  business: BusinessDetailRecord;
  showPublicActions: boolean;
}

export function ShareReportRow({ business, showPublicActions }: ShareReportRowProps) {
  if (!showPublicActions) return null;

  return (
    <div className="flex items-center justify-between px-1">
      <ShareButton
        title={business.business_name}
        text={`Check out ${business.business_name} on VerifyMzansi`}
      />
      <ReportDialog
        targetId={business.id}
        targetType="business"
        targetName={business.business_name}
        triggerLabel="Report inaccurate information"
      />
    </div>
  );
}
