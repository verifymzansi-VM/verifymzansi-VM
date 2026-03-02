"use client";

import dynamic from "next/dynamic";

const PageTransition = dynamic(
  () => import("@/components/page-transition").then((m) => ({ default: m.PageTransition })),
  {
    ssr: false,
    loading: () => <div className="flex-1 flex flex-col min-h-full" />,
  }
);

export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
