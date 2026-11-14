"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog (print, or save as PDF). Never printed. */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="no-print h-11 rounded-full"
      onClick={() => window.print()}
    >
      <Printer aria-hidden="true" className="h-4 w-4" />
      {label}
    </Button>
  );
}
