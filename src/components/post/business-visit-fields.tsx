"use client";

import { Input } from "@/components/ui/input";
import { PostLabel } from "@/components/post/post-label";
import {
  VISITOR_FEATURE_OPTIONS,
  type VisitDetails,
  type VisitorFeature,
} from "@/lib/forms/business-form";

const CHOICE_CLASS =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-input bg-card px-3 text-sm";
const BOX_CLASS = "h-4 w-4 rounded accent-brand-green-600";

/** Booking link or walk-ins, and what visitors find (parking, wheelchair access, kids). */
export function BusinessVisitFields({
  bookingUrl,
  onBookingUrlChange,
  bookingUrlError,
  visit,
  onVisitChange,
}: {
  bookingUrl: string;
  onBookingUrlChange: (value: string) => void;
  bookingUrlError?: string;
  visit: VisitDetails;
  onVisitChange: (next: VisitDetails) => void;
}) {
  const toggleFeature = (feature: VisitorFeature, on: boolean) =>
    onVisitChange({
      ...visit,
      visitorFeatures: on
        ? [...visit.visitorFeatures.filter((item) => item !== feature), feature]
        : visit.visitorFeatures.filter((item) => item !== feature),
    });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <PostLabel htmlFor="business-booking-url">Booking link</PostLabel>
        <Input
          id="business-booking-url"
          type="url"
          inputMode="url"
          value={bookingUrl}
          onChange={(event) => onBookingUrlChange(event.target.value)}
          placeholder="https://"
          aria-invalid={Boolean(bookingUrlError)}
        />
        {bookingUrlError ? <p className="inline-form-error">{bookingUrlError}</p> : null}
        <label className={CHOICE_CLASS}>
          <input
            type="checkbox"
            checked={visit.walkInPolicy === "walk_ins_welcome"}
            onChange={(event) =>
              onVisitChange({
                ...visit,
                walkInPolicy: event.target.checked ? "walk_ins_welcome" : "",
              })
            }
            className={BOX_CLASS}
          />
          Walk-ins welcome
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">For visitors</legend>
        <div className="flex flex-wrap gap-2">
          {VISITOR_FEATURE_OPTIONS.map((option) => (
            <label key={option.value} className={CHOICE_CLASS}>
              <input
                type="checkbox"
                checked={visit.visitorFeatures.includes(option.value)}
                onChange={(event) => toggleFeature(option.value, event.target.checked)}
                className={BOX_CLASS}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
