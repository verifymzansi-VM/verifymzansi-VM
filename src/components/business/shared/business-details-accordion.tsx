"use client";

import { Clock, CreditCard, DoorOpen, Info, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  BusinessDetailsCard,
  type BusinessDetailRecord,
} from "@/components/business/business-detail-content";
import { displayHoursText } from "@/lib/business/open-status";
import { WALK_IN_POLICY_LABELS } from "@/lib/forms/business-type-details";
import {
  BUSINESS_HOURS_GROUPS,
  PAYMENT_METHOD_LABELS,
  VISITOR_FEATURE_LABELS,
  readVisitDetails,
} from "@/lib/forms/business-form";
import type { BusinessType } from "@/types/enums";

/* ── Types ─────────────────────────────────────────────── */

interface BusinessDetailsAccordionProps {
  business: BusinessDetailRecord;
  businessType: BusinessType;
  businessDetails: Parameters<typeof BusinessDetailsCard>[0]["businessDetails"];
  serviceAreas: Parameters<typeof BusinessDetailsCard>[0]["serviceAreas"];
  servicesOffered: string[];
  servicesHeading?: string;
  paymentMethods: string[] | null;
  deliveryAvailable: boolean;
  operatingHours: Record<string, string | boolean> | null;
}

/* ── Accordion Item ────────────────────────────────────── */

function DetailSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border last:border-b-0">
      <h2 className="flex items-center gap-2 px-4 py-3 text-sm font-semibold">
        {icon}
        {title}
      </h2>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

/** The opening-hours lines a business stored, in reading order. */
export function openingHoursRows(hours: Record<string, unknown> | null | undefined) {
  if (!hours) return [];
  const rows: { label: string; value: string }[] = [];
  if (hours.Open_24_hours === true) rows.push({ label: "Every day", value: "Open 24 hours" });
  else
    for (const { stored, label } of BUSINESS_HOURS_GROUPS) {
      const text = hours[stored];
      if (typeof text === "string" && text.trim())
        rows.push({ label, value: displayHoursText(text) });
    }
  if (hours.By_appointment === true) rows.push({ label: "Visits", value: "By appointment" });
  return rows;
}

function OperatingHoursInline({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="space-y-2 text-sm">
      {rows.map((row, index) => (
        <div
          key={row.label}
          className={`flex items-center justify-between py-1${index > 0 ? " border-t" : ""}`}
        >
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="font-medium">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Payment & Delivery (inline, no Card wrapper) ──────── */

const DELIVERY_OPTION_LABELS: Record<string, string> = {
  in_store: "In store",
  delivery: "Delivery",
  collection: "Collection",
  nationwide: "Nationwide shipping",
};

function humanize(value: string) {
  const text = value.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function PaymentDeliveryInline({
  paymentMethods,
  deliveryAvailable,
}: {
  paymentMethods: string[] | null;
  deliveryAvailable: boolean;
}) {
  const hasPayment = paymentMethods && paymentMethods.length > 0;

  return (
    <div className="space-y-4">
      {hasPayment && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Payment methods</p>
          <div className="flex flex-wrap gap-2">
            {paymentMethods.map((method) => (
              <Badge key={method} variant="outline">
                {PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ??
                  humanize(method)}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {deliveryAvailable && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Delivery</p>
          <Badge variant="outline">Available</Badge>
        </div>
      )}
    </div>
  );
}

/* ── Main Accordion ────────────────────────────────────── */

export function BusinessDetailsAccordion({
  business,
  businessType,
  businessDetails,
  serviceAreas,
  servicesOffered,
  servicesHeading,
  paymentMethods,
  deliveryAvailable,
  operatingHours,
}: BusinessDetailsAccordionProps) {
  const hasDetails = Boolean(
    businessDetails ||
    business.store_number ||
    (businessType !== "home_business" && business.map_directions) ||
    serviceAreas
  );
  const hasServices = servicesOffered.length > 0;
  const hasPaymentOrDelivery =
    (paymentMethods && paymentMethods.length > 0) ||
    deliveryAvailable ||
    Boolean(business.delivery_options?.length);
  const hoursRows = openingHoursRows(operatingHours);
  const hasHours = hoursRows.length > 0;
  // Walk-ins and visitor features live in business_details for every business type.
  const visit = readVisitDetails(business.business_details);
  const hasVisit = Boolean(visit.walkInPolicy) || visit.visitorFeatures.length > 0;

  if (!hasDetails && !hasServices && !hasPaymentOrDelivery && !hasHours && !hasVisit) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      {hasDetails && (
        <DetailSection
          title="Business details"
          icon={<Info className="h-4 w-4 text-muted-foreground" />}
        >
          {/* Re-use BusinessDetailsCard but render without its own Card wrapper */}
          <div className="[&>div]:border-0 [&>div]:shadow-none [&>div]:p-0 [&>div>div:first-child]:hidden">
            <BusinessDetailsCard
              business={business}
              businessType={businessType}
              businessDetails={businessDetails}
              serviceAreas={serviceAreas}
            />
          </div>
        </DetailSection>
      )}

      {hasServices && (
        <DetailSection
          title={servicesHeading ?? "Services Offered"}
          icon={<Wrench className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="flex flex-wrap gap-2">
            {servicesOffered.map((service, index) => (
              <Badge key={index} variant="secondary">
                {service}
              </Badge>
            ))}
          </div>
        </DetailSection>
      )}

      {hasPaymentOrDelivery && (
        <DetailSection
          title="Payment & Delivery"
          icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}
        >
          {business.delivery_options?.length ? (
            <p className="mb-3 text-sm">
              Delivery options:{" "}
              {business.delivery_options
                .map((option) => DELIVERY_OPTION_LABELS[option] ?? humanize(option))
                .join(", ")}
            </p>
          ) : null}
          <PaymentDeliveryInline
            paymentMethods={paymentMethods}
            deliveryAvailable={deliveryAvailable}
          />
        </DetailSection>
      )}

      {hasHours && (
        <DetailSection
          title="Opening hours"
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        >
          <OperatingHoursInline rows={hoursRows} />
        </DetailSection>
      )}

      {hasVisit && (
        <DetailSection
          title="Visiting"
          icon={<DoorOpen className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-3 text-sm">
            {visit.walkInPolicy ? (
              <p className="font-medium">{WALK_IN_POLICY_LABELS[visit.walkInPolicy]}</p>
            ) : null}
            {visit.visitorFeatures.length > 0 ? (
              <ul aria-label="For visitors" className="flex flex-wrap gap-2">
                {visit.visitorFeatures.map((feature) => (
                  <li key={feature}>
                    <Badge variant="outline">{VISITOR_FEATURE_LABELS[feature]}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </DetailSection>
      )}
    </div>
  );
}
