"use client";

import { usePathname } from "next/navigation";

/**
 * Route wrapper rendered by the root template on every page.
 *
 * This used to be a framer-motion `motion.div` with `initial={false}` and
 * `animate={{ opacity: 1 }}`, which never animates anything (the element starts
 * in its animate state) but pulled framer-motion into the bundle of every
 * route. A plain element keeps the same markup and the same per-path remount.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="page-enter flex-1 flex flex-col min-h-full">
      {children}
    </div>
  );
}
