"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FoundationBillingCatalogue } from "@/lib/foundation/billing-catalogue";
import type { FoundationBilling } from "@/lib/foundation/billing-runtime";
import { ensureCsrfTokenReady, withCsrfHeaders } from "@/lib/utils/csrf";
import { useAuthStore } from "@/stores/auth-store";
import { useRouter } from "next/navigation";
async function fetchBilling(accountId?: string): Promise<FoundationBilling | null> {
  if (!accountId) return null;
  const response = await fetch("/api/foundation/billing", { cache: "no-store", redirect: "error" });
  if (response.status === 401) return null;
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Billing could not be loaded"
    );
  if (payload.account_id !== accountId || useAuthStore.getState().user?.id !== accountId)
    return null;
  return payload.data;
}
const money = (value: string) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    Number(value) / 100
  );
export function FoundationBillingClient({ catalogue }: { catalogue: FoundationBillingCatalogue }) {
  const accountId = useAuthStore((state) => state.user?.id);
  return (
    <FoundationBillingAccount
      key={accountId ?? "anonymous"}
      catalogue={catalogue}
      accountId={accountId}
    />
  );
}
function FoundationBillingAccount({
  catalogue,
  accountId,
}: {
  catalogue: FoundationBillingCatalogue;
  accountId?: string;
}) {
  const [billing, setBilling] = useState<FoundationBilling | null>(null);
  const router = useRouter();
  const signedOut = !accountId;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function refresh() {
    setBilling(await fetchBilling(accountId));
  }
  useEffect(() => {
    let cancelled = false;
    void fetchBilling(accountId).then(
      (data) => {
        if (!cancelled) setBilling(data);
      },
      (error) => {
        if (!cancelled)
          setMessage(error instanceof Error ? error.message : "Billing could not be loaded");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  async function command(path: string, body: object) {
    if (!accountId || useAuthStore.getState().user?.id !== accountId)
      throw new Error("Sign in to continue");
    await ensureCsrfTokenReady();
    const response = await fetch(path, {
      method: "POST",
      headers: withCsrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.error === "string" ? data.error : "The request could not be completed"
      );
    return data;
  }
  async function buy(planId: string) {
    if (signedOut) {
      router.push("/login?next=%2Fbilling");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const data = await command("/api/billing/create-checkout", { planId });
      const destination = new URL(data.checkoutUrl);
      if (
        destination.protocol !== "https:" ||
        destination.username ||
        destination.password ||
        destination.port ||
        !(destination.hostname === "ozow.com" || destination.hostname.endsWith(".ozow.com"))
      )
        throw new Error("The payment destination could not be verified");
      window.location.assign(destination.href);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout could not be started");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-9">
      <header>
        <h1 className="font-display text-3xl font-bold">Plans &amp; billing</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Buy a prepaid posting plan when you need one. Plans end after their stated duration and do
          not renew automatically. Event posts are free; paid visibility add-ons are optional.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          VerifyMzansi is not VAT registered. VAT is not charged.
        </p>
      </header>
      {message && (
        <p role="status" className="rounded-xl border bg-card p-4">
          {message}
        </p>
      )}
      {signedOut && (
        <p>
          <Link href="/login?next=%2Fbilling" className="text-primary underline">
            Sign in
          </Link>{" "}
          to see your payments and posting allowance.
        </p>
      )}
      {billing && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Your posting allowance</h2>
          {!billing.entitlements.length ? (
            <p className="text-muted-foreground">
              There is no active posting allowance on this account. Complete verification to receive
              an eligible introductory trial, or choose a plan below.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {billing.entitlements.map((entry) => (
                <article key={entry.id} className="rounded-2xl border bg-card p-5">
                  <h3 className="font-semibold">
                    {entry.area?.replaceAll("_", " ") ?? "All sections"}
                  </h3>
                  <p className="mt-2">
                    {entry.used} of {entry.slot_capacity} places in use
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ends {new Date(entry.ends_at).toLocaleDateString("en-ZA")}
                  </p>
                  {entry.slot_capacity >= 2 && (
                    <form
                      className="mt-4 space-y-2"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        setBusy(true);
                        try {
                          await command("/api/billing/plan-admins", {
                            entitlementId: entry.id,
                            action: String(form.get("action")),
                            email: String(form.get("email")),
                          });
                          setMessage("Plan administrator updated.");
                          await refresh();
                        } catch (error) {
                          setMessage(
                            error instanceof Error
                              ? error.message
                              : "The administrator could not be changed"
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <label className="block text-sm">
                        Additional administrator email
                        <input
                          name="email"
                          type="email"
                          required
                          maxLength={254}
                          className="mt-1 w-full rounded-lg border bg-background p-2"
                        />
                      </label>
                      <select name="action" className="rounded-lg border bg-background p-2">
                        <option value="add">Add administrator</option>
                        <option value="remove">Remove administrator</option>
                      </select>
                      <button disabled={busy} className="ml-2 rounded-lg border px-3 py-2">
                        Update
                      </button>
                    </form>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {(["market", "business", "tourism_events", null] as const).map((area) => {
        const plans = catalogue.plans.filter((plan) => plan.area === area);
        return (
          plans.length > 0 && (
            <section key={area ?? "all"} className="space-y-4">
              <h2 className="text-xl font-semibold">
                {area === "market"
                  ? "Mzansi Market"
                  : area === "business"
                    ? "Mzansi Business"
                    : area === "tourism_events"
                      ? "Tourism & Events"
                      : "Plans across all sections"}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {plans.map((plan) => (
                  <article key={plan.id} className="flex flex-col rounded-2xl border bg-card p-6">
                    <h3 className="text-lg font-semibold">{plan.label}</h3>
                    <p className="my-4 text-3xl font-bold text-primary">
                      {money(plan.price_cents)}
                    </p>
                    <p>
                      {plan.slot_capacity} posting {plan.slot_capacity === 1 ? "place" : "places"} ·{" "}
                      {plan.duration_days} days
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Up to {plan.max_photos} photos and {plan.max_videos} videos per post
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => void buy(plan.id)}
                      className="mt-6 rounded-lg bg-primary p-3 font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      {busy ? "Please wait…" : "Choose plan"}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )
        );
      })}
      {billing && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Recent payments</h2>
          {!billing.payments.length ? (
            <p className="text-muted-foreground">No payments yet.</p>
          ) : (
            billing.payments.map((pay) => (
              <article
                key={pay.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
              >
                <div>
                  <h3 className="font-semibold">{pay.label ?? "Posting plan"}</h3>
                  <p className="mt-1 text-sm">
                    {money(pay.amount_cents)} · {pay.status.replaceAll("_", " ")} ·{" "}
                    {new Date(pay.created_at).toLocaleDateString("en-ZA")}
                  </p>
                </div>
                <div className="flex gap-3">
                  <Link className="underline" href={`/billing/success?payment=${pay.id}`}>
                    Check status
                  </Link>
                  {pay.status === "pending" && (
                    <button
                      disabled={busy}
                      className="underline"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await command("/api/billing/cancel-pending", { paymentId: pay.id });
                          setMessage("Unpaid checkout cancelled.");
                          await refresh();
                        } catch (error) {
                          setMessage(
                            error instanceof Error
                              ? error.message
                              : "The payment could not be cancelled"
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Cancel unpaid checkout
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </section>
      )}
      {billing && billing.invoices.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Invoices</h2>
          {billing.invoices.map((invoice) => (
            <article key={invoice.id} className="rounded-xl border bg-card p-5">
              <h3 className="font-semibold">{invoice.invoice_number}</h3>
              <p className="mt-2">{invoice.description}</p>
              <p className="mt-2">
                Total: {money(invoice.total_cents)} · VAT: {money(invoice.vat_cents)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Issued {new Date(invoice.issued_at).toLocaleDateString("en-ZA")} · Payment{" "}
                {invoice.payment_status}
              </p>
            </article>
          ))}
          <button
            className="rounded-lg border px-4 py-3 print:hidden"
            onClick={() => window.print()}
          >
            Print or save invoices
          </button>
        </section>
      )}
      <Link className="inline-block text-primary underline" href="/dashboard/listings">
        Manage your posts
      </Link>
    </div>
  );
}
