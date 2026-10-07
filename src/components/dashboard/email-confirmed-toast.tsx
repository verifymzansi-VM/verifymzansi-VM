"use client";

import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export function EmailConfirmedToast() {
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("confirmed") === "true") {
      toast({
        title: "Email confirmed!",
        description: "Welcome to VerifyMzansi! Verify your phone and ID next to start posting.",
      });
      // Clean the URL so the toast doesn't re-fire on refresh
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast]);

  return null;
}
