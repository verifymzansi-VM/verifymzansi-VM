import { CUSTOMER_ACCESS_OPTIONS, customerAccessSchema } from "@/lib/forms/customer-access";

export function CustomerAccessSummary({
  value,
  meetingPoint,
}: {
  value: unknown;
  meetingPoint?: unknown;
}) {
  const result = customerAccessSchema.safeParse(value);
  if (!result.success) return null;
  const access = result.data;
  return (
    <section className="space-y-2 rounded-xl border p-4" aria-label="Customer access">
      <h3 className="font-semibold">How we serve customers</h3>
      <ul className="list-inside list-disc text-sm leading-6">
        {CUSTOMER_ACCESS_OPTIONS.filter((o) => access.methods.includes(o.value)).map((o) => (
          <li key={o.value}>{o.label}</li>
        ))}
      </ul>
      {typeof meetingPoint === "string" && meetingPoint.trim() && (
        <p className="text-sm">Meeting point: {meetingPoint}</p>
      )}
      {access.methods.includes("visit") && access.venue && (
        <p className="text-sm">Venue: {access.venue}</p>
      )}
      {access.methods.includes("travel") && (
        <p className="text-sm">Service areas: {access.serviceAreas}</p>
      )}
      {access.methods.includes("delivery") && (
        <p className="text-sm">
          Delivery: {access.nationwide ? "Nationwide" : access.deliveryAreas}
        </p>
      )}
    </section>
  );
}
