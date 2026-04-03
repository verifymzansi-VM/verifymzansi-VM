"use client";

import { useState } from "react";
import { ChevronDown, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PromotionCard } from "@/components/listings/promotion-card";
import type { TrustLevel } from "@/types/enums";

interface PastEvent {
  id: string;
  title: string;
  price: number | null;
  negotiable?: boolean;
  imageUrl?: string;
  posterUrl?: string;
  logoUrl?: string | null;
  province: string;
  city: string;
  createdAt: string;
  ownerTrustLevel?: TrustLevel;
  ownerName?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export function PastEventsAccordion({ events }: { events: PastEvent[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <Clock className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-xl font-display font-semibold text-muted-foreground">Past Events</h2>
        <Badge variant="secondary" className="text-xs">
          {events.length}
        </Badge>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground ml-auto transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
          {events.map((event) => (
            <div key={event.id} className="opacity-60 hover:opacity-80 transition-opacity">
              <PromotionCard
                id={event.id}
                title={event.title}
                price={event.price}
                negotiable={event.negotiable}
                imageUrl={event.imageUrl}
                posterUrl={event.posterUrl}
                logoUrl={event.logoUrl}
                province={event.province}
                city={event.city}
                promotionType="event"
                createdAt={event.createdAt}
                ownerTrustLevel={event.ownerTrustLevel}
                ownerName={event.ownerName}
                startDate={event.startDate}
                endDate={event.endDate}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
