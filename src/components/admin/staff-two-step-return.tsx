"use client";

import { useEffect } from "react";
import { STAFF_MFA_PATH } from "@/lib/auth/staff-mfa";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";

/**
 * Where a staff API answer says the person must check their authenticator
 * again, or null. The answers are the proxy's and checkStaffApiMfa's
 * `mfa_required`, checkStaffApiMfa's `step_up_required`, and the
 * `staff_mfa_required` reason of staffCommandRefusal. The address is rebuilt
 * here: only this site's two-step page, with at most its confirm=1 flag (any
 * other query, such as an encoded `next`, is dropped), returning to `here`.
 */
export function staffTwoStepTarget(
  status: number,
  body: unknown,
  here: string,
  origin: string
): string | null {
  if (status !== 403 || !body || typeof body !== "object") return null;
  const { code, reason, verifyUrl, redirectUrl } = body as Record<string, unknown>;
  const asksToVerify =
    code === "mfa_required" || code === "step_up_required" || reason === "staff_mfa_required";
  if (!asksToVerify) return null;
  const given = typeof verifyUrl === "string" ? verifyUrl : redirectUrl;
  let confirm = false;
  if (typeof given === "string") {
    try {
      const url = new URL(given, origin);
      confirm =
        url.origin === origin &&
        url.pathname === STAFF_MFA_PATH &&
        url.searchParams.getAll("confirm").length === 1 &&
        url.searchParams.get("confirm") === "1";
    } catch {
      confirm = false;
    }
  }
  return staffVerifyHref(confirm ? `${STAFF_MFA_PATH}?confirm=1` : STAFF_MFA_PATH, here);
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

/** True on a staff (back-office) page, the only pages this acts on. */
function onStaffPage(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/**
 * Staff screens: when a staff action is refused because the authenticator
 * check has run out (12 hours, or 15 minutes for sensitive actions), go to
 * the two-step page and come back here afterwards, the same as opening a
 * staff page does. Screens that already do this themselves are unaffected:
 * both send the person to the same page. Several refusals at once navigate
 * once. Once the staff area has closed (or outside /admin) it does nothing,
 * even if another wrapper kept it in the fetch chain. Renders nothing.
 */
export function StaffTwoStepReturn() {
  useEffect(() => {
    const original = window.fetch;
    let mounted = true;
    let leaving = false;
    const watched: typeof window.fetch = async (input, init) => {
      const response = await original.call(window, input, init);
      if (
        !mounted ||
        leaving ||
        response.status !== 403 ||
        !onStaffPage(window.location.pathname) ||
        !isOwnApiRequest(input, window.location.origin) ||
        !(response.headers.get("content-type") ?? "").includes("application/json")
      )
        return response;
      const body = await response
        .clone()
        .json()
        .catch(() => null);
      // Checked again: another refusal may have started the move meanwhile.
      if (!mounted || leaving) return response;
      const target = staffTwoStepTarget(
        response.status,
        body,
        window.location.pathname + window.location.search,
        window.location.origin
      );
      if (target) {
        leaving = true;
        window.location.assign(target);
      }
      return response;
    };
    window.fetch = watched;
    return () => {
      mounted = false;
      if (window.fetch === watched) window.fetch = original;
    };
  }, []);
  return null;
}
