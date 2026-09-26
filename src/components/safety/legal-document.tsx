import type { ReactNode } from "react";
import { ChevronDown, FileText } from "lucide-react";
import type { BreadcrumbItem } from "@/components/layout/breadcrumbs";
import { InfoHero } from "@/components/safety/info-hero";

export interface LegalSection {
  /** Anchor id used by the table of contents (e.g. "verification-data"). */
  id: string;
  title: string;
  /** Shorter label for the table of contents; defaults to `title`. */
  navLabel?: string;
  content: ReactNode;
}

interface LegalDocumentProps {
  title: string;
  description?: ReactNode;
  /** Short status line such as "Updated March 2026". */
  meta?: string;
  breadcrumbs?: BreadcrumbItem[];
  sections: LegalSection[];
  /** Plain-language summary shown above the first section. */
  summary?: ReactNode;
}

function TocLinks({ sections }: { sections: LegalSection[] }) {
  return (
    <ol className="space-y-0.5 text-sm">
      {sections.map((section, index) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-brand-green-700 dark:text-brand-green-300">
              {index + 1}.
            </span>
            <span className="leading-5">{section.navLabel ?? section.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * Long-form legal layout: hero band, sticky table of contents on desktop, a
 * collapsible contents list on phones and a readable `max-w-prose` column.
 */
export function LegalDocument({
  title,
  description,
  meta,
  breadcrumbs,
  sections,
  summary,
}: LegalDocumentProps) {
  return (
    <>
      <InfoHero
        title={title}
        description={description}
        breadcrumbs={breadcrumbs}
        kicker={meta}
        kickerIcon={FileText}
        tone="neutral"
      />

      <div className="container-page py-8 sm:py-12">
        <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-32">
              <p className="px-2.5 text-sm font-semibold text-foreground">On this page</p>
              <div className="mt-3">
                <TocLinks sections={sections} />
              </div>
            </div>
          </nav>

          <div className="min-w-0 max-w-3xl">
            <details className="group surface-card mb-8 lg:hidden">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                On this page
                <ChevronDown
                  className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="border-t border-border/60 p-2">
                <TocLinks sections={sections} />
              </div>
            </details>

            {summary && (
              <div className="mb-10 max-w-prose rounded-2xl border border-brand-green/20 bg-brand-green/5 p-5 text-sm leading-6 text-foreground/85 dark:bg-brand-green/10">
                {summary}
              </div>
            )}

            <div className="space-y-12">
              {sections.map((section, index) => (
                <section
                  key={section.id}
                  id={section.id}
                  aria-labelledby={`${section.id}-title`}
                  className="scroll-mt-32"
                >
                  <h2
                    id={`${section.id}-title`}
                    className="flex items-baseline gap-3 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl"
                  >
                    <span
                      aria-hidden="true"
                      className="text-sm font-semibold tabular-nums text-brand-green-700 dark:text-brand-green-300"
                    >
                      {index + 1}.
                    </span>
                    {section.title}
                  </h2>
                  <div className="mt-4">{section.content}</div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Renders an array of legal paragraphs. Strings starting with "•" become list
 * items; consecutive bullets are grouped into one semantic `<ul>`.
 */
export function LegalBlocks({ paragraphs }: { paragraphs: readonly string[] }) {
  const blocks: Array<{ type: "p"; text: string } | { type: "ul"; items: string[] }> = [];
  for (const paragraph of paragraphs) {
    if (paragraph.startsWith("•")) {
      const item = paragraph.replace(/^•\s*/, "");
      const last = blocks[blocks.length - 1];
      if (last?.type === "ul") last.items.push(item);
      else blocks.push({ type: "ul", items: [item] });
    } else {
      blocks.push({ type: "p", text: paragraph });
    }
  }

  return (
    <div className="max-w-prose space-y-4 text-[15px] leading-7 text-foreground/80">
      {blocks.map((block, index) =>
        block.type === "p" ? (
          <p key={index}>{block.text}</p>
        ) : (
          <ul key={index} className="space-y-2 pl-1">
            {block.items.map((item) => (
              <li key={item} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green-600 dark:bg-brand-green-400"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
