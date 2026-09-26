"use client";

import { Clock, CreditCard, Info, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  BusinessDetailsCard,
  type BusinessDetailRecord,
} from "@/components/business/business-detail-content";
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
  operatingHours: Record<string, string> | null;
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
    <section className="border-b border-border/70 px-5 py-5 last:border-b-0 sm:px-6">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
        {icon}
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

function OperatingHoursInline({ hours }: { hours: Record<string, string> }) {
  return (
    <dl className="space-y-2 text-sm">
      {hours.Mon_Fri && (
        <div className="flex items-center justify-between py-1">
          <dt className="text-muted-foreground">Mon – Fri</dt>
          <dd className="font-medium">{hours.Mon_Fri}</dd>
        </div>
      )}
      {hours.Sat && (
        <div className="flex items-center justify-between border-t py-1">
          <dt className="text-muted-foreground">Saturday</dt>
          <dd className="font-medium">{hours.Sat}</dd>
        </div>
      )}
      {hours.Sun && (
        <div className="flex items-center justify-between border-t py-1">
          <dt className="text-muted-foreground">Sunday / Holidays</dt>
          <dd className="font-medium">{hours.Sun}</dd>
        </div>
      )}
    </dl>
  );
}

/* ── Payment & Delivery (inline, no Card wrapper) ──────── */

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  eft: "EFT",
  snapscan: "SnapScan",
  capitec_pay: "Capitec Pay",
  other: "Other",
};

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
          <p className="mb-2 text-sm font-medium text-muted-foreground">Payment methods</p>
          <div className="flex flex-wrap gap-2">
            {paymentMethods.map((method) => (
              <Badge key={method} variant="outline">
                {PAYMENT_METHOD_LABELS[method] ?? humanize(method)}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {deliveryAvailable && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Delivery</p>
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
  const hasHours = operatingHours && Object.keys(operatingHours).length > 0;

  if (!hasDetails && !hasServices && !hasPaymentOrDelivery && !hasHours) {
    return null;
  }

  return (
    <div className="surface-card elev-xs overflow-hidden rounded-2xl text-card-foreground">
      {hasDetails && (
        <DetailSection
          title="Business details"
          icon={<Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
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
          title={servicesHeading ?? "Services offered"}
          icon={<Wrench className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
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
          icon={<CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
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
          icon={<Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        >
          <OperatingHoursInline hours={operatingHours!} />
        </DetailSection>
      )}
    </div>
  );
}
