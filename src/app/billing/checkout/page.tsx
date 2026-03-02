"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CreditCard, AlertCircle } from "lucide-react";

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = searchParams.get("plan");

  // Derive validation error eagerly — avoids setState in effect
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isValidPlan = planId ? uuidRegex.test(planId) : false;
  const [error, setError] = useState<string | null>(
    planId && !isValidPlan ? "Invalid plan ID. Please select a plan from the billing page." : null
  );

  useEffect(() => {
    if (!planId) {
      router.push("/billing");
      return;
    }

    if (!isValidPlan) return;

    async function createCheckout() {
      try {
        const res = await fetch("/api/billing/create-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Failed to create checkout");
          return;
        }

        // Redirect to PayFast checkout
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        } else {
          setError("No checkout URL received");
        }
      } catch {
        setError("Failed to connect to payment service");
      }
    }

    createCheckout();
  }, [planId, router, isValidPlan]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          {error ? (
            <AlertCircle className="h-8 w-8 text-destructive" />
          ) : (
            <CreditCard className="h-8 w-8 text-brand-green" />
          )}
        </div>
        {error ? (
          <>
            <h1 className="font-display text-xl font-bold">Checkout Error</h1>
            <p className="text-sm text-destructive">{error}</p>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-bold">Redirecting to PayFast...</h1>
            <p className="text-sm text-muted-foreground">
              You&apos;re being redirected to our secure payment partner.
            </p>
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-brand-green" />
          </>
        )}
        <p className="text-xs text-muted-foreground">
          <button onClick={() => router.push("/billing")} className="text-brand-green underline">
            Go back to billing
          </button>
        </p>
      </div>
    </div>
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
