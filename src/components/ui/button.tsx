import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/50 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/95 hover:shadow-md shadow-sm active:bg-primary/80 disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:shadow-md hover:shadow-destructive/20 active:bg-destructive/80",
        outline:
          "border border-input bg-background/50 backdrop-blur-sm hover:bg-accent/80 hover:text-accent-foreground hover:shadow-sm",
        secondary:
          "bg-secondary/80 backdrop-blur-sm text-secondary-foreground hover:bg-secondary hover:shadow-sm",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Trust-scale-aware variants
        "trust-verified":
          "bg-brand-green text-white hover:bg-brand-green-600 hover:shadow-md hover:shadow-brand-green/20 active:bg-brand-green-700 disabled:opacity-100 disabled:bg-brand-green-100 disabled:text-brand-green-700",
        "trust-gold":
          "bg-brand-gold text-brand-gold-950 hover:bg-brand-gold-500 hover:shadow-md hover:shadow-brand-gold/30 active:bg-brand-gold-600",
      },
      size: {
        default: "h-11 md:h-10 px-4 py-2",
        sm: "h-10 md:h-9 rounded-md px-3",
        lg: "h-12 md:h-11 rounded-md px-8",
        xl: "h-14 md:h-12 rounded-lg px-10 text-base",
        icon: "h-11 w-11 md:h-10 md:w-10",
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

export { Button, buttonVariants };
