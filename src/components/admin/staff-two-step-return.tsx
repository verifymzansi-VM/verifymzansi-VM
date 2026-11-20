"use client";

import { useEffect } from "react";
import { STAFF_MFA_PATH } from "@/lib/auth/staff-mfa";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";

/**
 * Where a staff API answer says the person must check their authenticator
 * again, or null. The answers are the proxy's and checkStaffApiMfa's
 * `mfa_required`, checkStaffApiMfa's `step_up_required`, and the
 * `staff_mfa_required` reason of staffCommandRefusal. Only a path on the
 * two-step page is followed, and `here` is where it comes back to.
 */
export function staffTwoStepTarget(status: number, body: unknown, here: string): string | null {
  if (status !== 403 || !body || typeof body !== "object") return null;
  const { code, reason, verifyUrl, redirectUrl } = body as Record<string, unknown>;
  const asksToVerify =
    code === "mfa_required" || code === "step_up_required" || reason === "staff_mfa_required";
  if (!asksToVerify) return null;
  const given = typeof verifyUrl === "string" ? verifyUrl : redirectUrl;
  const verify =
    typeof given === "string" &&
    (given === STAFF_MFA_PATH || given.startsWith(`${STAFF_MFA_PATH}?`)) &&
    !given.includes("next=")
      ? given
      : STAFF_MFA_PATH;
  return staffVerifyHref(verify, here);
}

/** True for this site's own API (the only answers this follows). */
export function isOwnApiRequest(input: RequestInfo | URL, origin: string): boolean {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, origin);
    return url.origin === origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/**
 * Staff screens: when a staff action is refused because the authenticator
 * check has run out (12 hours, or 15 minutes for sensitive actions), go to
 * the two-step page and come back here afterwards, the same as opening a
 * staff page does. Screens that already do this themselves are unaffected:
 * both send the person to the same page. Renders nothing.
 */
export function StaffTwoStepReturn() {
  useEffect(() => {
    const original = window.fetch;
    let leaving = false;
    const watched: typeof window.fetch = async (input, init) => {
      const response = await original.call(window, input, init);
      if (
        !leaving &&
        response.status === 403 &&
        isOwnApiRequest(input, window.location.origin) &&
        (response.headers.get("content-type") ?? "").includes("application/json")
      ) {
        const body = await response
          .clone()
          .json()
          .catch(() => null);
        const target = staffTwoStepTarget(
          response.status,
          body,
          window.location.pathname + window.location.search
        );
        if (target) {
          leaving = true;
          window.location.assign(target);
        }
      }
      return response;
    };
    window.fetch = watched;
    return () => {
      if (window.fetch === watched) window.fetch = original;
    };
  }, []);
  return null;
}
