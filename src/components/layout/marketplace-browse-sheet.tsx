"use client";

import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { MarketplaceSectionNav } from "./marketplace-section-nav";

interface MarketplaceBrowseSheetProps {
  triggerLabel?: string;
}

export function MarketplaceBrowseSheet({
  triggerLabel = "Open marketplace sections",
}: MarketplaceBrowseSheetProps) {
  return (
    <Sheet>
      <div className="fixed bottom-20 right-4 z-40 lg:hidden">
        <SheetTrigger asChild>
          <Button
            size="lg"
            className="h-14 w-14 rounded-full bg-brand-green shadow-lg hover:bg-brand-green/90"
            aria-label={triggerLabel}
          >
            <LayoutGrid className="h-5 w-5" />
          </Button>
        </SheetTrigger>
      </div>

      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-[calc(2rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="mb-4">
          <SheetTitle>Browse marketplace sections</SheetTitle>
          <SheetDescription>
            Jump between Mzansi Market, Mzansi Business, Promotions, and Events from one place.
          </SheetDescription>
        </SheetHeader>

        <MarketplaceSectionNav
          variant="mobile"
          heading="Choose a section"
          description="Each section opens with its own clean filters so it is easier to find what you need."
          className="border-none bg-transparent p-0 shadow-none"
        />
      </SheetContent>
    </Sheet>
  );
}
