import { forwardRef, type SVGProps } from "react";

/**
 * VerifyMzansi shield-check icon. Drawn on the same 24px outline grid as the
 * lucide icon set so it inherits `currentColor`, stroke width and sizing
 * wherever it replaces a generic shield icon.
 */
export const BrandShield = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(function BrandShield(
  { children, strokeWidth = 2, ...props },
  ref
) {
  return (
    <svg
      ref={ref}
      width="24"
      height="24"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
      viewBox="0 0 24 24"
      fill="none"
    >
      <path d="M12 2.75 19.25 5.4a1 1 0 0 1 .65.94v5.2c0 4.73-3.2 8.6-7.55 9.93a1.2 1.2 0 0 1-.7 0C7.3 20.14 4.1 16.27 4.1 11.54v-5.2a1 1 0 0 1 .65-.94Z" />
      <path d="m8.6 12.1 2.4 2.4 4.6-5" />
      {children}
    </svg>
  );
});

/** Keep warnings recognizable while using the same brand artwork. */
export const BrandShieldAlert = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function BrandShieldAlert(props, ref) {
    return (
      <BrandShield ref={ref} {...props}>
        <circle cx="18" cy="18" r="5.25" fill="#d63b22" stroke="white" strokeWidth="1.25" />
        <path d="M18 15.6v2.8M18 20.4v.05" stroke="white" strokeWidth="1.75" />
      </BrandShield>
    );
  }
);
