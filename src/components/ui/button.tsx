import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button hierarchy (owner-approved, 20 November 2026): one filled primary per
 * screen (`default`, or `trust-gold` on a dark-green band); secondary actions
 * are `outline`; small or back choices are `link`; `destructive` only for the
 * final "yes, delete" in a confirm box.
 */
const PRIMARY =
  "btn-shine bg-brand-green-600 text-white shadow-sm shadow-brand-green/25 motion-safe:hover:-translate-y-0.5 hover:bg-brand-green-700 hover:shadow-md hover:shadow-brand-green/30 active:bg-brand-green-800 disabled:bg-brand-green-200 disabled:text-brand-green-900 disabled:opacity-100 dark:bg-brand-green-500 dark:hover:bg-brand-green-400 dark:text-brand-green-950";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none active:scale-[0.98] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** The one main action on a screen (filled brand green). */
        default: PRIMARY,
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:shadow-md hover:shadow-destructive/20 active:bg-destructive/80",
        outline:
          "border border-input bg-card text-foreground hover:border-foreground/30 hover:bg-muted/70",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "text-foreground/80 hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        /** A quieter green action (light green pill), e.g. the header's Register and + Post. */
        tinted:
          "bg-brand-green-100 text-brand-green-800 hover:bg-brand-green-200 active:bg-brand-green-300 dark:bg-brand-green-900/60 dark:text-brand-green-100 dark:hover:bg-brand-green-900",
        /** Same look as `default`; kept so existing call sites read the same. */
        "trust-verified": PRIMARY,
        /** The one main action on a dark-green brand band. */
        "trust-gold":
          "btn-shine bg-brand-gold text-brand-gold-950 shadow-sm shadow-brand-gold/30 motion-safe:hover:-translate-y-0.5 hover:bg-brand-gold-300 hover:shadow-md active:bg-brand-gold-500",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3",
        lg: "h-12 px-6 text-[15px]",
        xl: "h-14 rounded-2xl px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { Button };
