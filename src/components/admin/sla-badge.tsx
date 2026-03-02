import { Badge } from "@/components/ui/badge";
import type { SlaState } from "@/lib/utils/sla";

interface SlaBadgeProps {
  state: SlaState;
  hoursRemaining?: number;
}

const SLA_CONFIG: Record<
  SlaState,
  { label: string; variant: "destructive" | "default" | "secondary"; icon: string }
> = {
  breached: { label: "Overdue", variant: "destructive", icon: "🔴" },
  "at-risk": { label: "Due Soon", variant: "default", icon: "🟡" },
  "on-track": { label: "On Track", variant: "secondary", icon: "🟢" },
};

export function SlaBadge({ state, hoursRemaining }: SlaBadgeProps) {
  const config = SLA_CONFIG[state];

  return (
    <Badge variant={config.variant} className="text-[10px] gap-1">
      <span>{config.icon}</span>
      <span>{config.label}</span>
      {hoursRemaining !== undefined && hoursRemaining > 0 && state !== "breached" && (
        <span className="opacity-70">
          (
          {hoursRemaining < 1
            ? `${Math.floor(hoursRemaining * 60)}m`
            : `${Math.floor(hoursRemaining)}h`}
          )
        </span>
      )}
    </Badge>
  );
}
