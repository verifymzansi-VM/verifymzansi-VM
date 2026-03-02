import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

interface StatItem {
  icon: LucideIcon;
  label: string;
  value: number | string;
  trend?: { value: number; isPositive: boolean };
  href?: string;
}

interface AreaOverviewStatsProps {
  stats: StatItem[];
}

export function AreaOverviewStats({ stats }: AreaOverviewStatsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-muted text-muted-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-display">{stat.value}</p>
                  <div className="flex items-center gap-1">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    {stat.trend && (
                      <span
                        className={`text-[10px] font-medium ${
                          stat.trend.isPositive ? "text-green-600" : "text-destructive"
                        }`}
                      >
                        {stat.trend.isPositive ? "+" : ""}
                        {stat.trend.value}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
