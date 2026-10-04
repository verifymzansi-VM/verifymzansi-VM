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

export function XIcon(props: SocialIconProps) {
  return (
    <SocialIconBase {...props}>
      <path d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.2l-4.9-6.3L5.4 21H2.3l7.2-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" />
    </SocialIconBase>
  );
}

export function TikTokIcon(props: SocialIconProps) {
  return (
    <SocialIconBase {...props}>
      <path d="M16.6 2h-3.3v13.3a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.2 6.2 0 1 0 5.3 6.2V8.6a7.9 7.9 0 0 0 4.6 1.5V6.8a4.6 4.6 0 0 1-4.6-4.6v-.2Z" />
    </SocialIconBase>
  );
}

export function WhatsAppIcon(props: SocialIconProps) {
  return (
    <SocialIconBase {...props}>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.65.08-.3-.15-1.26-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.8h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.43 9.88-9.88 9.88m8.41-18.3A11.81 11.81 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.9a11.82 11.82 0 0 0-3.48-8.4Z" />
    </SocialIconBase>
  );
}
