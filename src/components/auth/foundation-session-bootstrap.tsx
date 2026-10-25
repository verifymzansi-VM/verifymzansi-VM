"use client";
import { getDataBackend } from "@/lib/data-backend";
import { useAuth } from "@/hooks/use-auth";
function SessionSync() {
  useAuth();
  return null;
}
export function FoundationSessionBootstrap() {
  return getDataBackend() === "foundation" ? <SessionSync /> : null;
}
