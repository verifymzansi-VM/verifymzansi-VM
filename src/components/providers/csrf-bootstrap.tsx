"use client";

import { useEffect } from "react";
import { ensureCsrfTokenReady } from "@/lib/utils/csrf";

export function CsrfBootstrap() {
  useEffect(() => {
    void ensureCsrfTokenReady();
  }, []);

  return null;
}
