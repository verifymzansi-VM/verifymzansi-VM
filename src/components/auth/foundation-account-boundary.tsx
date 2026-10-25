"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
const reloadDocument = () => window.location.replace(window.location.href);
/** Do not render a previous account's cached private surface after an account
 * switch. A fresh document also discards the framework's old RSC cache. */
export function FoundationAccountBoundary({
  accountId,
  staff = false,
  children,
  reload = reloadDocument,
}: {
  accountId?: string;
  staff?: boolean;
  children: ReactNode;
  reload?: () => void;
}) {
  const currentId = useAuthStore((state) => state.user?.id);
  const loading = useAuthStore((state) => state.isLoading);
  const staffAccess = useAuthStore((state) => state.foundationContext?.staff?.can_access === true);
  const [boundTo, setBoundTo] = useState<string | null>(accountId ?? null);
  if (!loading && currentId && !boundTo) setBoundTo(currentId);
  useEffect(() => {
    if (!loading && currentId && boundTo && currentId !== boundTo) reload();
  }, [loading, currentId, boundTo, reload]);
  const different = Boolean(currentId && boundTo && currentId !== boundTo);
  const ready = !loading && Boolean(currentId && currentId === boundTo) && (!staff || staffAccess);
  const discard = different || (!loading && (!currentId || (staff && !staffAccess)));
  return (
    <>
      {!discard && (
        <div hidden={!ready} inert={!ready}>
          {children}
        </div>
      )}
      {!ready &&
        (loading || (currentId && (!boundTo || different)) ? (
          <p role="status" className="p-6 text-muted-foreground">
            Loading your account…
          </p>
        ) : !currentId ? (
          <p className="p-6">
            <Link className="text-primary underline" href="/login">
              Sign in
            </Link>{" "}
            to continue.
          </p>
        ) : (
          <p className="p-6">
            A current staff session and authenticator verification are required.{" "}
            <Link className="text-primary underline" href="/staff/two-step">
              Complete two-step verification
            </Link>
            .
          </p>
        ))}
    </>
  );
}
