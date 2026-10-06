/**
 * The poster's position at the business, shown only once it is verified:
 * from the CIPC director list, or confirmed by the company (representative).
 */
export function VerifiedPosition({
  position,
  source,
}: {
  position: string | null | undefined;
  source: string | null | undefined;
}) {
  if (!position) return null;
  const representative = source === "representative";
  return (
    <p className="text-sm text-muted-foreground">
      {position}
      <span className="sr-only">
        {representative ? ", confirmed by the company" : ", confirmed on CIPC records"}
      </span>
      <span aria-hidden="true">{representative ? " · confirmed by company" : " · CIPC"}</span>
    </p>
  );
}
