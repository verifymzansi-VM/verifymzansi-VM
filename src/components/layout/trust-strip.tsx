interface TrustStripProps {
  variant?: "green" | "blue";
  title?: string;
}

export function TrustStrip({
  variant = "green",
  title = "Latest on Mzansi Market",
}: TrustStripProps) {
  const isGreen = variant === "green";
  const bgClass = isGreen
    ? "bg-brand-green-50/50 dark:bg-brand-green-950/30"
    : "bg-blue-50/50 dark:bg-blue-950/30";
  const titleClass = isGreen
    ? "text-brand-green dark:text-brand-green-300"
    : "text-brand-blue dark:text-brand-blue-200";

  return (
    <section className={`hidden sm:block border-b ${bgClass}`}>
      <div className="container-page py-3">
        <h2 className={`text-center text-lg font-bold ${titleClass}`}>{title}</h2>
      </div>
    </section>
  );
}
