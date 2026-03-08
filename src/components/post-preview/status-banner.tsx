"use client";

import { CheckCircle2, Clock3, EyeOff, ShieldAlert, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

type PreviewStatus =
  | "live"
  | "pending_moderation"
  | "pending_review"
  | "draft"
  | "rejected"
  | string
  | null
  | undefined;

function getStatusMeta(status: PreviewStatus) {
  switch (status) {
    case "live":
      return {
        title: "This post is live",
        description: "The public marketplace page is visible to everyone.",
        badge: "Live",
        icon: CheckCircle2,
        className:
          "border-brand-green/30 bg-brand-green/5 text-foreground dark:border-brand-green/40",
      };
    case "draft":
      return {
        title: "Draft preview",
        description: "Only you can see this draft preview until the post is submitted.",
        badge: "Draft",
        icon: EyeOff,
        className: "border-border bg-muted/40 text-foreground",
      };
    case "rejected":
      return {
        title: "Changes needed before this can go live",
        description:
          "This owner preview shows the exact submitted content while you review and update it.",
        badge: "Rejected",
        icon: XCircle,
        className:
          "border-destructive/30 bg-destructive/5 text-foreground dark:border-destructive/40",
      };
    case "pending_review":
    case "pending_moderation":
    default:
      return {
        title: "Submitted for review",
        description:
          "Your post is saved and visible here to you, but the public detail page stays hidden until moderation approves it.",
        badge: "Pending",
        icon: Clock3,
        className:
          "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100",
      };
  }
}

export function PostPreviewStatusBanner({
  status,
  created = false,
}: {
  status: PreviewStatus;
  created?: boolean;
}) {
  const meta = getStatusMeta(status);
  const Icon = meta.icon;

  return (
    <Alert className={meta.className}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTitle>{created ? "Post created successfully" : meta.title}</AlertTitle>
          <Badge variant="outline" className="border-current/20 bg-background/50 text-current">
            {meta.badge}
          </Badge>
        </div>
        <AlertDescription>
          {created
            ? "This creator-only preview shows exactly what was submitted. The public page remains hidden until moderation approves it."
            : meta.description}
        </AlertDescription>
        {status !== "live" ? (
          <div className="flex items-center gap-2 text-xs opacity-90">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Public detail pages still load `live` content only.</span>
          </div>
        ) : null}
      </div>
    </Alert>
  );
}
