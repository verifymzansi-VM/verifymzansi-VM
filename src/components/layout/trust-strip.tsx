interface TrustStripProps {
  variant?: "green" | "blue";
}

export function TrustStrip({ variant = "green" }: TrustStripProps) {
  const isGreen = variant === "green";
  const bgClass = isGreen
    ? "bg-brand-green-50/50 dark:bg-brand-green-950/30"
    : "bg-blue-50/50 dark:bg-blue-950/30";

  return (
    <section className={`hidden sm:block border-b ${bgClass}`}>
      <div className="container-page py-3">
        <h2 className="text-center text-lg font-bold text-brand-green dark:text-brand-green-300">
          Latest on Mzansi Market
        </h2>
      </div>
    </section>
  );
}
