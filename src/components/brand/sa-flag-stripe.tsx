import { cn } from "@/lib/utils";

/** Thin flag-colour rule for the edge of dark brand surfaces. */
export function SaFlagStripe({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex h-1.5 w-full", className)}>
      <span className="flex-[3] bg-brand-green-500" />
      <span className="flex-1 bg-brand-gold-400" />
      <span className="flex-1 bg-white" />
      <span className="flex-[2] bg-brand-red-600" />
      <span className="flex-1 bg-white" />
      <span className="flex-[2] bg-brand-blue-700" />
      <span className="flex-1 bg-black" />
    </div>
  );
}
