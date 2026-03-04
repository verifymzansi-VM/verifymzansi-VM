"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ToggleLeft } from "lucide-react";

type FlagMode = "off" | "on" | "percent" | "allowlist";

interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  description: string | null;
  mode: FlagMode | null;
  rollout_percent: number | null;
  allowlist_roles: string[] | null;
  updated_at: string;
  updated_reason: string | null;
}

interface FeatureFlagsClientProps {
  initialFlags: FeatureFlag[];
}

const MODE_LABELS: Record<FlagMode, string> = {
  off: "Off",
  on: "On (100%)",
  percent: "Percent Rollout",
  allowlist: "Role Allowlist",
};

const AVAILABLE_ROLES = ["admin", "moderator", "seller", "buyer"];

export function FeatureFlagsClient({ initialFlags }: FeatureFlagsClientProps) {
  const [flags, setFlags] = useState<FeatureFlag[]>(initialFlags);
  const [toggling, setToggling] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const handleModeChange = async (
    key: string,
    mode: FlagMode,
    percent?: number,
    allowlistRoles?: string[],
    reason?: string
  ) => {
    if (!reason?.trim()) {
      toast({
        title: "Reason required",
        description: "Please provide a reason for this change.",
        variant: "destructive",
      });
      return;
    }

    setToggling(key);

    try {
      const response = await fetch("/api/admin/feature-flags/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          mode,
          percent: mode === "percent" ? percent : undefined,
          allowlist_roles: mode === "allowlist" ? allowlistRoles : undefined,
          reason,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update flag");
      }

      setFlags((prev) =>
        prev.map((f) =>
          f.key === key
            ? {
                ...f,
                mode,
                enabled: mode === "on",
                rollout_percent: percent ?? f.rollout_percent,
                allowlist_roles: allowlistRoles ?? f.allowlist_roles,
                updated_at: new Date().toISOString(),
                updated_reason: reason ?? null,
              }
            : f
        )
      );

      toast({
        title: "Flag updated",
        description: `"${key}" set to ${MODE_LABELS[mode]}.`,
      });

      router.refresh();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update flag",
        variant: "destructive",
      });
    } finally {
      setToggling(null);
    }
  };

  // Legacy toggle for quick on/off
  const handleQuickToggle = async (key: string, enabled: boolean) => {
    setToggling(key);

    try {
      const response = await fetch("/api/admin/feature-flags/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to toggle flag");
      }

      setFlags((prev) =>
        prev.map((f) =>
          f.key === key
            ? { ...f, enabled, mode: enabled ? "on" : "off", updated_at: new Date().toISOString() }
            : f
        )
      );

      toast({
        title: `Flag ${enabled ? "enabled" : "disabled"}`,
        description: `"${key}" is now ${enabled ? "ON" : "OFF"}.`,
      });

      router.refresh();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to toggle flag",
        variant: "destructive",
      });
    } finally {
      setToggling(null);
    }
  };

  if (flags.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <ToggleLeft className="h-8 w-8 mb-3" />
          <p className="text-lg font-medium">No feature flags configured</p>
          <p className="text-sm mt-1">
            Add flags via the database migration to start using feature toggles.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {flags.map((flag) => (
        <FlagCard
          key={flag.id}
          flag={flag}
          toggling={toggling === flag.key}
          onQuickToggle={handleQuickToggle}
          onModeChange={handleModeChange}
        />
      ))}
    </div>
  );
}

function FlagCard({
  flag,
  toggling,
  onQuickToggle,
  onModeChange,
}: {
  flag: FeatureFlag;
  toggling: boolean;
  onQuickToggle: (key: string, enabled: boolean) => void;
  onModeChange: (
    key: string,
    mode: FlagMode,
    percent?: number,
    allowlistRoles?: string[],
    reason?: string
  ) => void;
}) {
  const currentMode = flag.mode ?? (flag.enabled ? "on" : "off");
  const [editMode, setEditMode] = useState<FlagMode>(currentMode as FlagMode);
  const [editPercent, setEditPercent] = useState(flag.rollout_percent ?? 0);
  const [editRoles, setEditRoles] = useState<string[]>(flag.allowlist_roles ?? []);
  const [reason, setReason] = useState("");
  const [expanded, setExpanded] = useState(false);

  const modeBadgeColor: Record<FlagMode, string> = {
    off: "secondary",
    on: "default",
    percent: "outline",
    allowlist: "outline",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base font-mono">{flag.key}</CardTitle>
          {flag.description && <CardDescription>{flag.description}</CardDescription>}
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={modeBadgeColor[currentMode as FlagMode] as "default" | "secondary" | "outline"}
          >
            {currentMode === "percent"
              ? `${flag.rollout_percent ?? 0}%`
              : (MODE_LABELS[currentMode as FlagMode] ?? currentMode)}
          </Badge>
          <Switch
            checked={flag.enabled || currentMode === "on"}
            onCheckedChange={(checked) => onQuickToggle(flag.key, checked)}
            disabled={toggling}
            aria-label={`Toggle ${flag.key}`}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Last updated:{" "}
            {new Date(flag.updated_at).toLocaleString("en-ZA", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {flag.updated_reason && (
              <span className="ml-2 italic">&mdash; {flag.updated_reason}</span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-brand-green underline"
          >
            {expanded ? "Hide controls" : "Advanced"}
          </button>
        </div>

        {expanded && (
          <div className="space-y-3 border-t pt-3">
            {/* Mode selector */}
            <div className="space-y-1">
              <label htmlFor="flag-rollout-mode" className="text-xs font-medium">
                Rollout mode
              </label>
              <select
                id="flag-rollout-mode"
                title="Flag rollout mode"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={editMode}
                onChange={(e) => setEditMode(e.target.value as FlagMode)}
              >
                {(Object.entries(MODE_LABELS) as [FlagMode, string][]).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            {/* Percent slider */}
            {editMode === "percent" && (
              <div className="space-y-1">
                <label className="text-xs font-medium">Rollout percentage: {editPercent}%</label>
                <input
                  type="range"
                  title="Rollout percentage"
                  min={0}
                  max={100}
                  step={1}
                  value={editPercent}
                  onChange={(e) => setEditPercent(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            )}

            {/* Role allowlist */}
            {editMode === "allowlist" && (
              <div className="space-y-1">
                <label htmlFor="flag-allowed-roles" className="text-xs font-medium">
                  Allowed roles
                </label>
                <div
                  id="flag-allowed-roles"
                  role="group"
                  aria-label="Allowed roles"
                  className="flex flex-wrap gap-2"
                >
                  {AVAILABLE_ROLES.map((role) => (
                    <label key={role} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={editRoles.includes(role)}
                        onChange={(e) => {
                          setEditRoles(
                            e.target.checked
                              ? [...editRoles, role]
                              : editRoles.filter((r) => r !== role)
                          );
                        }}
                      />
                      {role}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Reason input */}
            <div className="space-y-1">
              <label htmlFor="flag-change-reason" className="text-xs font-medium">
                Reason for change (required)
              </label>
              <input
                id="flag-change-reason"
                type="text"
                placeholder="e.g. Internal testing rollout"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              />
            </div>

            <button
              type="button"
              disabled={toggling || !reason.trim()}
              onClick={() => onModeChange(flag.key, editMode, editPercent, editRoles, reason)}
              className="inline-flex items-center justify-center rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
            >
              Apply Configuration
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
