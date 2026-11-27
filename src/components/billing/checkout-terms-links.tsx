import Link from "next/link";

const linkClassName =
  "font-medium text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300";

/**
 * The Terms and Refunds links after a checkout's consent box (ECTA s43: the
 * terms are one tap away before paying). Both open in a new tab so the order
 * on screen is kept.
 */
export function CheckoutTermsLinks() {
  return (
    <>
      <Link href="/terms" target="_blank" rel="noopener noreferrer" className={linkClassName}>
        Terms
      </Link>
      {" · "}
      <Link
        href="/terms#refunds"
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
      >
        Refunds
      </Link>
    </>
  );
}

/**
 * Under a checkout's total: VerifyMzansi is not registered for VAT (decision
 * C3), so the price confirmed is the whole price and no VAT is added.
 */
export function NoVatCharged() {
  return (
    <p data-testid="checkout-no-vat" className="mt-1.5 text-xs text-muted-foreground">
      No VAT is charged.
    </p>
  );
}
