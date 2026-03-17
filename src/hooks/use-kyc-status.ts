"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ACCOUNT_PROFILE_WRITE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import { createClient } from "@/lib/supabase/client";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("useKycStatus");

interface KycStep {
  id: string;
  step_type: string;
  status: string;
  created_at: string;
}

type KycStatus = "unverified" | "pending" | "verified" | "rejected" | "loading";

/**
 * Hook providing the current user's KYC verification status and pending steps.
 */
export function useKycStatus() {
  const [status, setStatus] = useState<KycStatus>("loading");
  const [steps, setSteps] = useState<KycStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

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

      // Check account profile verification status
      const { data: profile } = await supabase
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .select("account_verification_status")
        .eq("user_id", user.id)
        .single();

      const verificationStatus = readAccountVerificationStatus(profile);

      if (verificationStatus === "verified") {
        setStatus("verified");
      } else if (verificationStatus === "rejected") {
        setStatus("rejected");
      } else {
        // Check if there are pending steps
        const { data: verificationSteps } = await supabase
          .from("verification_steps")
          .select("id, step_type, status, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true });

        setSteps(verificationSteps || []);

        const hasPending = verificationSteps?.some(
          (s: { status: string }) => s.status === "pending"
        );
        setStatus(hasPending ? "pending" : "unverified");
      }
    } catch (err) {
      log.error("Failed to fetch KYC status", {
        error: err instanceof Error ? err.message : String(err),
      });
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
