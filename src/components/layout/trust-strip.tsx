import { ShieldCheck, BadgeCheck, Search } from "lucide-react";

interface TrustStripProps {
  variant?: "green" | "blue";
}

export function TrustStrip({ variant = "green" }: TrustStripProps) {
  const isGreen = variant === "green";
  const bgClass = isGreen
    ? "bg-brand-green-50/50 dark:bg-brand-green-950/30"
    : "bg-blue-50/50 dark:bg-blue-950/30";
  const iconClass = isGreen ? "text-brand-green" : "text-brand-blue";

  return (
    <section className={`hidden sm:block border-b ${bgClass}`}>
      <div className="container-page py-3">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-xs sm:text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className={`h-4 w-4 ${iconClass}`} />
            Every seller verified by ID & selfie
          </span>
          <span className="hidden sm:inline text-border">|</span>
          <span className="flex items-center gap-1.5">
            <BadgeCheck className={`h-4 w-4 ${iconClass}`} />
            Photos & videos — not just text ads
          </span>
          <span className="hidden sm:inline text-border">|</span>
          <span className="flex items-center gap-1.5">
            <Search className={`h-4 w-4 ${iconClass}`} />
            Request promotion on our social channels
          </span>
        </div>
      </div>
    </section>
  );
}
