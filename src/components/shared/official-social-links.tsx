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
      <h4 className="font-display font-semibold text-xs">{title}</h4>
      <div className="mt-2 flex flex-wrap gap-2">
        {socialLinks.map((link) => (
          <a
            key={link.key}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className={
              linkClassName ??
              "inline-flex items-center rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}
