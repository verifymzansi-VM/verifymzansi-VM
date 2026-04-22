import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        // Marketplace area badges
        "mzansi-market": "area-mzansi-market border",
        "mall-shops": "area-mall-shops border",
        "business-ads": "area-business-ads border",
        // Status badges
        live: "border-transparent bg-brand-green-100 text-brand-green-800 dark:bg-brand-green-900/40 dark:text-brand-green-300",
        pending:
          "border-transparent bg-brand-gold-100 text-brand-gold-800 dark:bg-brand-gold-900/40 dark:text-brand-gold-300",
        rejected:
          "border-transparent bg-brand-red-100 text-brand-red-800 dark:bg-brand-red-900/40 dark:text-brand-red-300",
        draft: "border-transparent bg-warm-100 text-warm-600 dark:bg-warm-800 dark:text-warm-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
