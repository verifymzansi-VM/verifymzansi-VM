"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CreditCard, AlertCircle } from "lucide-react";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { getActivePlanByCheckoutId } from "@/lib/constants/pricing";
import { getFriendlyCheckoutError } from "@/lib/billing/checkout-copy";

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = searchParams.get("plan");
  const plan = planId ? getActivePlanByCheckoutId(planId) : undefined;
  const checkoutInitiated = useRef(false);

  // Derive validation error eagerly — avoids setState in effect
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isValidPlan = planId ? uuidRegex.test(planId) : false;
  const [error, setError] = useState<string | null>(
    planId && !isValidPlan ? "Invalid plan ID. Please select a plan from the billing page." : null
  );
  const [statusText, setStatusText] = useState(
    plan?.name ? `Preparing secure checkout for ${plan.name}…` : "Preparing secure checkout…"
  );

  useEffect(() => {
    if (!planId) {
      router.push("/billing");
      return;
    }

    if (!isValidPlan) return;

    // Prevent duplicate checkout creation from React strict-mode double-mount
    if (checkoutInitiated.current) return;
    checkoutInitiated.current = true;
    const controller = new AbortController();

    async function createCheckout() {
      try {
        const res = await fetch("/api/billing/create-checkout", {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ planId }),
          signal: controller.signal,
        });

        const data = await res.json();

        if (!res.ok) {
          setError(getFriendlyCheckoutError(res.status, data.error, plan?.name));
          return;
        }

        // Redirect to the hosted checkout
        if (data.checkoutUrl) {
          setStatusText("Redirecting you to secure Ozow checkout…");
          window.location.assign(data.checkoutUrl);
        } else {
          setError("Secure checkout did not return a redirect URL.");
        }
      } catch (checkoutError) {
        if (checkoutError instanceof DOMException && checkoutError.name === "AbortError") {
          return;
        }
        setError(getFriendlyCheckoutError(undefined, null, plan?.name));
      }
    }

    createCheckout();
    return () => controller.abort();
  }, [planId, plan?.name, router, isValidPlan]);

  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-background px-4 scroll-mt-24"
    >
      <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white/95 p-6 text-center shadow-[0_28px_90px_-56px_rgba(15,23,42,0.5)] dark:border-white/10 dark:bg-slate-950/90">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          {error ? (
            <AlertCircle className="h-6 w-6 text-destructive" />
          ) : (
            <CreditCard className="h-6 w-6 text-brand-green" />
          )}
        </div>
        {plan?.name ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            {plan.name}
          </p>
        ) : null}
        {error ? (
          <>
            <h1 className="font-display text-xl font-bold">Checkout error</h1>
            <p className="mt-2 text-sm text-destructive">{error}</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-full bg-brand-green px-5 py-2 text-sm font-semibold text-white"
              >
                Sign in
              </Link>
              <Link
                href="/billing"
                className="inline-flex items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 dark:border-white/15 dark:text-white"
              >
                Go back to billing
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-bold">Redirecting to secure checkout…</h1>
            <p className="mt-2 text-sm text-muted-foreground">{statusText}</p>
            <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-brand-green" />
          </>
        )}
        {!error ? (
          <p className="mt-4 text-xs text-muted-foreground">
            You will return to VerifyMzansi after Ozow confirms the payment attempt.
          </p>
        ) : null}
      </div>
    </main>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
