import { forwardRef, type SVGProps } from "react";

/** Shared shield artwork; SVG keeps existing icon sizing and accessibility props. */
export const BrandShield = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(function BrandShield(
  { children, ...props },
  ref
) {
  return (
    <svg
      ref={ref}
      width="24"
      height="24"
      aria-hidden="true"
      {...props}
      viewBox="0 0 24 24"
      fill="none"
    >
      <image href="/images/brand-shield-small.png?v=20260924" width="24" height="24" />
      {children}
    </svg>
  );
});

/** Keep warnings recognizable while using the same brand artwork. */
export const BrandShieldAlert = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function BrandShieldAlert(props, ref) {
    return (
      <BrandShield ref={ref} {...props}>
        <circle cx="18" cy="18" r="6" fill="#b91c1c" stroke="white" strokeWidth="1" />
        <path d="M18 14.5v4M18 21v.1" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </BrandShield>
    );
  }
);
