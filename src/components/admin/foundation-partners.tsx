"use client";
import { z } from "zod";
import { useFoundationStaffAction } from "@/hooks/use-foundation-staff-action";
import { ActionMessage, ReasonField, readForm } from "./commercial/commercial-action";
import { formatPlanPrice } from "@/lib/constants/pricing";
import type {
  readFoundationStaffPartners,
  readFoundationStaffCommissions,
} from "@/lib/foundation/staff-directory";
const partnerReply = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  status: z.enum(["pending", "active", "suspended"]),
  commission_bps: z.number().int().nullable(),
  revision: z.number().int().positive(),
});
const commissionReply = z.strictObject({
  id: z.uuid(),
  status: z.enum(["pending", "approved", "paid", "reversed"]),
});
type Partner = Awaited<ReturnType<typeof readFoundationStaffPartners>>[number];
type Commission = Awaited<ReturnType<typeof readFoundationStaffCommissions>>[number];
const inputClass = "block w-full rounded-md border bg-background p-2";
export function FoundationPartners({
  accountId,
  partners,
  commissions,
}: {
  accountId: string;
  partners: Partner[];
  commissions: Commission[];
}) {
  const action = useFoundationStaffAction(accountId);
  return (
    <div className="space-y-7">
      <ActionMessage message={action.message} />
      <section className="space-y-4 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Add a partner</h2>
        <p>
          Use a confirmed account ID. Leave the rate blank to use the server&apos;s configured
          default.
        </p>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = readForm(event.currentTarget);
            void action.run({
              path: "/api/foundation/staff/partners",
              body: {
                account_id: form.accountId,
                action: "create",
                code: form.code.toUpperCase(),
                ...(form.rate ? { commission_bps: Math.round(Number(form.rate) * 100) } : {}),
                reason: form.reason,
              },
              schema: partnerReply,
              successText: "Partner created",
            });
          }}
        >
          <label>
            Account ID
            <input className={inputClass} name="accountId" required pattern="[a-fA-F0-9-]{36}" />
          </label>
          <label>
            Referral code
            <input
              className={inputClass}
              name="code"
              required
              minLength={4}
              maxLength={16}
              pattern="[A-Za-z0-9]{4,16}"
            />
          </label>
          <label>
            Commission percentage
            <input className={inputClass} type="number" name="rate" min={0} max={50} step="0.01" />
          </label>
          <ReasonField />
          <button
            type="submit"
            disabled={action.busy}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          >
            Create partner
          </button>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Partners</h2>
        {!partners.length && <p>No partners have been added.</p>}
        {partners.map((partner) => (
          <article key={partner.id} className="space-y-3 rounded-lg border p-5">
            <h3 className="font-semibold">
              {partner.code} · {partner.status}
            </h3>
            <p className="break-all text-sm">Account: {partner.account_id}</p>
            <p>
              {partner.referrals} referrals · Pending{" "}
              {formatPlanPrice(Number(partner.pending_cents))} · Approved{" "}
              {formatPlanPrice(Number(partner.approved_cents))}
            </p>
            <form
              className="grid gap-3 sm:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                const form = readForm(event.currentTarget);
                void action.run({
                  path: "/api/foundation/staff/partners",
                  body: {
                    account_id: partner.account_id,
                    action: form.operation,
                    ...(form.operation === "set_rate" && form.rate !== ""
                      ? { commission_bps: Math.round(Number(form.rate) * 100) }
                      : {}),
                    reason: form.reason,
                  },
                  schema: partnerReply,
                  successText: "Partner updated",
                });
              }}
            >
              <label>
                Change
                <select name="operation" className={inputClass}>
                  <option value="activate">Activate</option>
                  <option value="suspend">Suspend</option>
                  <option value="set_rate">Change commission rate</option>
                </select>
              </label>
              <label>
                Commission percentage
                <input
                  className={inputClass}
                  name="rate"
                  type="number"
                  min={0}
                  max={50}
                  step="0.01"
                  defaultValue={partner.commission_bps === null ? "" : partner.commission_bps / 100}
                />
              </label>
              <ReasonField />
              <button
                type="submit"
                disabled={action.busy}
                className="rounded-md border px-4 py-2 disabled:opacity-50"
              >
                Save partner change
              </button>
            </form>
          </article>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Commissions</h2>
        {!commissions.length && <p>No commissions have been recorded.</p>}
        {commissions.map((commission) => (
          <article key={commission.id} className="space-y-3 rounded-lg border p-5">
            <p className="font-semibold">
              {formatPlanPrice(Number(commission.amount_cents))} · {commission.status}
            </p>
            <p className="break-all text-sm">Payment: {commission.payment_id}</p>
            <p className="text-sm">
              Eligible from{" "}
              {new Date(commission.eligible_at).toLocaleString("en-ZA", {
                timeZone: "Africa/Johannesburg",
              })}
            </p>
            <form
              className="grid gap-3 sm:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                const form = readForm(event.currentTarget);
                void action.run({
                  path: "/api/foundation/staff/commissions",
                  body: {
                    commission_id: commission.id,
                    action: form.operation,
                    ...(form.operation === "mark_paid" ? { reference: form.reference } : {}),
                    reason: form.reason,
                  },
                  schema: commissionReply.refine((v) => v.id === commission.id),
                  successText: "Commission record updated",
                });
              }}
            >
              <label>
                Change
                <select name="operation" className={inputClass}>
                  <option value="approve">Approve</option>
                  <option value="mark_paid">Record payment</option>
                  <option value="reverse">Reverse</option>
                </select>
              </label>
              <label>
                Payment reference
                <input className={inputClass} name="reference" minLength={3} maxLength={120} />
              </label>
              <ReasonField />
              <button
                type="submit"
                disabled={action.busy}
                className="rounded-md border px-4 py-2 disabled:opacity-50"
              >
                Save commission change
              </button>
            </form>
            <p className="text-sm text-muted-foreground">
              Recording a payment updates its audit record. Funds are transferred separately.
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
