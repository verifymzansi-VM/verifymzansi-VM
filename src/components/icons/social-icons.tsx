import type { SVGProps } from "react";

type SocialIconProps = SVGProps<SVGSVGElement>;

function SocialIconBase({ children, ...props }: SocialIconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  );
}

export function FacebookIcon(props: SocialIconProps) {
  return (
    <SocialIconBase {...props}>
      <path d="M13.5 22v-8h2.7l.4-3h-3.1V9.1c0-.9.3-1.6 1.7-1.6H17V4.8c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3V11H7.5v3h2.8v8h3.2Z" />
    </SocialIconBase>
  );
}

export function InstagramIcon(props: SocialIconProps) {
  return (
    <SocialIconBase {...props}>
      <path d="M7.8 3h8.4A4.8 4.8 0 0 1 21 7.8v8.4a4.8 4.8 0 0 1-4.8 4.8H7.8A4.8 4.8 0 0 1 3 16.2V7.8A4.8 4.8 0 0 1 7.8 3Zm0 1.8A3 3 0 0 0 4.8 7.8v8.4a3 3 0 0 0 3 3h8.4a3 3 0 0 0 3-3V7.8a3 3 0 0 0-3-3H7.8Zm8.9 1.4a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM12 7.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8Zm0 1.8a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z" />
    </SocialIconBase>
  );
}

export function TwitterIcon(props: SocialIconProps) {
  return (
    <SocialIconBase {...props}>
      <path d="M18.9 5.3a5 5 0 0 1-1.5.4 2.6 2.6 0 0 0 1.1-1.4 5.1 5.1 0 0 1-1.7.6 2.6 2.6 0 0 0-4.5 1.8c0 .2 0 .4.1.6A7.4 7.4 0 0 1 7 4.8a2.6 2.6 0 0 0 .8 3.5 2.6 2.6 0 0 1-1.2-.3v.1a2.6 2.6 0 0 0 2.1 2.6 2.7 2.7 0 0 1-1.2 0 2.6 2.6 0 0 0 2.4 1.8A5.3 5.3 0 0 1 6 15.6a7.4 7.4 0 0 0 4 1.2c4.8 0 7.5-4 7.5-7.5v-.3a5.4 5.4 0 0 0 1.4-1.4Z" />
    </SocialIconBase>
  );
}
