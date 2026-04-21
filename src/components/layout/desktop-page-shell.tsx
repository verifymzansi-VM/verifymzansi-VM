"use client";

import { usePathname } from "next/navigation";

interface DesktopPageShellProps {
  children: React.ReactNode;
}

function isAdminPath(pathname: string | null): boolean {
  return pathname === "/admin" || pathname?.startsWith("/admin/") === true;
}

export function DesktopPageShell({ children }: DesktopPageShellProps) {
  const pathname = usePathname();
  const desktopScaleDisabled = isAdminPath(pathname);

  return (
    <div
      className={desktopScaleDisabled ? undefined : "desktop-page-scale"}
      data-desktop-scale={desktopScaleDisabled ? "off" : "on"}
    >
      {children}
    </div>
  );
}

export { isAdminPath };
