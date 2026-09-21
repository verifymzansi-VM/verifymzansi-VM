import { getOfficialSocialLinks, type OfficialSocialLinkConfig } from "@/lib/official-social-links";

interface OfficialSocialLinksProps {
  links: OfficialSocialLinkConfig;
  title?: string;
  className?: string;
  linkClassName?: string;
}

export function OfficialSocialLinks({
  links,
  title = "Follow VerifyMzansi",
  className,
  linkClassName,
}: OfficialSocialLinksProps) {
  const socialLinks = getOfficialSocialLinks(links);

  if (socialLinks.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <h4 className="font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/70">
        {title}
      </h4>
      <div className="mt-2 flex flex-wrap gap-2">
        {socialLinks.map((link) => (
          <a
            key={link.key}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className={
              linkClassName ??
              "inline-flex items-center rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground transition-all duration-200 hover:border-brand-green/40 hover:text-brand-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:text-brand-green-200"
            }
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}
