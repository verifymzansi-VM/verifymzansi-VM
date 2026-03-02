"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface KycStep {
  id: string;
  step_type: string;
  status: string;
  created_at: string;
  risk_level?: string;
}

type KycStatus = "unverified" | "pending" | "verified" | "rejected" | "loading";

/**
 * Hook providing the current user's KYC verification status and pending steps.
 */
export function useKycStatus() {
  const [status, setStatus] = useState<KycStatus>("loading");
  const [steps, setSteps] = useState<KycStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const supabase = createClient();

  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setStatus("unverified");
        setSteps([]);
        return;
      }

      // Check seller profile verification status
      const { data: profile } = await supabase
        .from("seller_profiles")
        .select("seller_verification_status")
        .eq("user_id", user.id)
        .single();

      if (profile?.seller_verification_status === "verified") {
        setStatus("verified");
      } else if (profile?.seller_verification_status === "rejected") {
        setStatus("rejected");
      } else {
        // Check if there are pending steps
        const { data: verificationSteps } = await supabase
          .from("verification_steps")
          .select("id, step_type, status, created_at, risk_level")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });

        setSteps(verificationSteps || []);

        const hasPending = verificationSteps?.some(
          (s: { status: string }) => s.status === "pending"
        );
        setStatus(hasPending ? "pending" : "unverified");
      }
    } catch (err) {
      console.error(
        "[useKycStatus] Failed to fetch KYC status:",
        err instanceof Error ? err.message : err
      );
      setStatus("unverified");
    } finally {
      setIsLoading(false);
    }
    // supabase is a stable singleton — safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const nextStep =
    steps.length > 0 ? steps.find((s) => s.status !== "approved")?.step_type || null : "id_doc";

  return {
    status,
    steps,
    nextStep,
    isLoading,
    isVerified: status === "verified",
    isPending: status === "pending",
    refresh: fetchStatus,
  };
}
