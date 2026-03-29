"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CreditCard, AlertCircle } from "lucide-react";
import { withCsrfHeaders } from "@/lib/utils/csrf";

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = searchParams.get("plan");
  const checkoutInitiated = useRef(false);

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

    // Prevent duplicate checkout creation from React strict-mode double-mount
    if (checkoutInitiated.current) return;
    checkoutInitiated.current = true;

    async function createCheckout() {
      try {
        const res = await fetch("/api/billing/create-checkout", {
          method: "POST",
          headers: withCsrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ planId }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Failed to create checkout");
          return;
        }

        // Redirect to the hosted checkout
        if (data.checkoutUrl) {
          window.location.assign(data.checkoutUrl);
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
    <main id="main-content" className="flex min-h-screen items-center justify-center scroll-mt-24">
      <div className="text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          {error ? (
            <AlertCircle className="h-6 w-6 text-destructive" />
          ) : (
            <CreditCard className="h-6 w-6 text-brand-green" />
          )}
        </div>
        {error ? (
          <>
            <h1 className="font-display text-xl font-bold">Checkout Error</h1>
            <p className="text-sm text-destructive">{error}</p>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-bold">Redirecting to secure checkout...</h1>
            <p className="text-sm text-muted-foreground">Redirecting to Ozow secure checkout...</p>
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-brand-green" />
          </>
        )}
        <p className="text-xs text-muted-foreground">
          <Link href="/billing" className="text-brand-green underline">
            Go back to billing
          </Link>
        </p>
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
