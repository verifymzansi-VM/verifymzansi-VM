"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prefersReduced = useReducedMotion();

  // When the user prefers reduced motion OR on mobile, skip animation entirely
  if (prefersReduced) {
    return <div className="flex-1 flex flex-col min-h-full">{children}</div>;
  }

  // Lightweight fade-only transition — no blur filter (very expensive on mobile GPUs)
  return (
    <motion.div
      key={pathname}
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex-1 flex flex-col min-h-full"
    >
      {children}
    </motion.div>
  );
}
