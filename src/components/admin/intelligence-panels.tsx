import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "emerald" | "sky" | "amber" | "rose" | "violet" | "slate";

export type ChartDatum = {
  label: string;
  value: number;
  caption?: string;
  tone?: Tone;
};

export type DecisionItem = {
  label: string;
  value: string;
  detail: string;
  tone?: Tone;
};

const toneClasses: Record<Tone, { bar: string; dot: string; text: string; bg: string }> = {
  emerald: {
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
  },
  sky: {
    bar: "bg-sky-500",
    dot: "bg-sky-500",
    text: "text-sky-700 dark:text-sky-300",
    bg: "bg-sky-50 dark:bg-sky-950/30",
  },
  amber: {
    bar: "bg-amber-500",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/30",
  },
  rose: {
    bar: "bg-rose-500",
    dot: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-300",
    bg: "bg-rose-50 dark:bg-rose-950/30",
  },
  violet: {
    bar: "bg-violet-500",
    dot: "bg-violet-500",
    text: "text-violet-700 dark:text-violet-300",
    bg: "bg-violet-50 dark:bg-violet-950/30",
  },
  slate: {
    bar: "bg-slate-500",
    dot: "bg-slate-500",
    text: "text-slate-700 dark:text-slate-300",
    bg: "bg-slate-50 dark:bg-slate-900/40",
  },
};

function maxValue(data: ChartDatum[]) {
  return Math.max(1, ...data.map((item) => item.value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 0 }).format(value);
}

export function HorizontalBarPanel({
  title,
  description,
  data,
}: {
  title: string;
  description?: string;
  data: ChartDatum[];
}) {
  const max = maxValue(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {data.map((item) => {
          const tone = toneClasses[item.tone ?? "slate"];
          const width =
            item.value > 0 ? `${Math.max(3, Math.round((item.value / max) * 100))}%` : "0%";

          return (
            <div key={item.label} className="space-y-2">
              <div className="flex items-center justify-between gap-4 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone.dot)} />
                  <span className="truncate font-medium">{item.label}</span>
                </div>
                <span className="shrink-0 font-semibold">{formatNumber(item.value)}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", tone.bar)} style={{ width }} />
              </div>
              {item.caption ? (
                <p className="text-xs text-muted-foreground">{item.caption}</p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function ColumnChartPanel({
  title,
  description,
  data,
  valuePrefix = "",
}: {
  title: string;
  description?: string;
  data: ChartDatum[];
  valuePrefix?: string;
}) {
  const max = maxValue(data);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent>
        <div className="flex h-56 items-end gap-3 border-b border-l px-3 pt-6">
          {data.map((item) => {
            const tone = toneClasses[item.tone ?? "slate"];
            const height =
              item.value > 0 ? `${Math.max(4, Math.round((item.value / max) * 100))}%` : "0%";

            return (
              <div
                key={item.label}
                className="flex h-full min-w-0 flex-1 flex-col justify-end gap-2"
              >
                <div className="flex h-full items-end">
                  <div
                    className={cn("w-full rounded-t-md", tone.bar)}
                    style={{ height }}
                    title={`${item.label}: ${valuePrefix}${formatNumber(item.value)}`}
                  />
                </div>
                <div className="min-h-10 text-center">
                  <p className="truncate text-xs font-medium">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {valuePrefix}
                    {formatNumber(item.value)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function DecisionPanel({
  title,
  description,
  items,
}: {
  title: string;
  description?: string;
  items: DecisionItem[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="grid gap-3">
        {items.map((item) => {
          const tone = toneClasses[item.tone ?? "slate"];

          return (
            <div key={item.label} className={cn("rounded-lg border p-4", tone.bg)}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                </div>
                <p className={cn("shrink-0 text-sm font-semibold", tone.text)}>{item.value}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
