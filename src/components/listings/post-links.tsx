import type { ComponentType, SVGProps } from "react";
import { Globe } from "lucide-react";
import {
  FacebookIcon,
  InstagramIcon,
  TikTokIcon,
  XIcon,
  YouTubeIcon,
} from "@/components/icons/social-icons";
import { safeExternalHref } from "@/lib/utils/sanitize-html";

type LinkKey = "website" | "facebook" | "instagram" | "tiktok" | "youtube" | "twitter";

const LINKS: { key: LinkKey; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { key: "website", label: "Website", icon: Globe },
  { key: "facebook", label: "Facebook", icon: FacebookIcon },
  { key: "instagram", label: "Instagram", icon: InstagramIcon },
  { key: "tiktok", label: "TikTok", icon: TikTokIcon },
  { key: "youtube", label: "YouTube", icon: YouTubeIcon },
  { key: "twitter", label: "X", icon: XIcon },
];

/** The safe, filled links of a post, in display order. */
export function postLinkItems(
  website: string | null | undefined,
  social: Record<string, string | null | undefined> | null | undefined
) {
  const values: Partial<Record<LinkKey, string | null | undefined>> = { ...social, website };
  return LINKS.flatMap((link) => {
    const href = values[link.key] ? safeExternalHref(String(values[link.key])) : undefined;
    return href && href !== "#" ? [{ ...link, href }] : [];
  });
}

/** The one links block every post page shows: website and social links as tappable buttons. */
export function PostLinks({
  website,
  social,
  title = "Links",
}: {
  website?: string | null;
  social?: Record<string, string | null | undefined> | null;
  title?: string;
}) {
  const items = postLinkItems(website, social);
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <ul className="flex flex-wrap gap-2">
        {items.map(({ key, label, icon: Icon, href }) => (
          <li key={key}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
