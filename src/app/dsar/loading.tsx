import { Loader2 } from "lucide-react";

export default function DsarLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-brand-green mx-auto" />
        <p className="text-sm text-muted-foreground">Loading DSAR form…</p>
      </div>
    </div>
  );
}
