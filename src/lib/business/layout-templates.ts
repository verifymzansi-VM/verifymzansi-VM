/* ══════════════════════════════════════════════════════════════
   Layout Template Definitions
   Three structurally distinct business profile layouts.
   ══════════════════════════════════════════════════════════════ */

export type LayoutTemplate = "cinematic" | "showcase" | "professional";

export interface LayoutTemplateMeta {
  id: LayoutTemplate;
  name: string;
  tagline: string;
  description: string;
  /** Where video sits in the layout hierarchy */
  videoRole: "hero" | "inline-grid" | "dedicated-card";
  /** Icon name from lucide for the chooser UI */
  icon: "Film" | "LayoutGrid" | "Briefcase";
}

export const LAYOUT_TEMPLATES: Record<LayoutTemplate, LayoutTemplateMeta> = {
  cinematic: {
    id: "cinematic",
    name: "Cinematic",
    tagline: "Video-first, immersive hero",
    description:
      "Full-bleed video hero with overlay branding. Best for visual businesses that want to make a bold first impression.",
    videoRole: "hero",
    icon: "Film",
  },
  showcase: {
    id: "showcase",
    name: "Showcase",
    tagline: "Gallery-first, product-focused",
    description:
      "Media grid with video as the featured tile. Best for product businesses that want to display inventory and variety.",
    videoRole: "hero",
    icon: "LayoutGrid",
  },
  professional: {
    id: "professional",
    name: "Professional",
    tagline: "Clean, organized layout",
    description:
      "Professional layout with visual hero and organized details. Best for service businesses that need to present credentials clearly.",
    videoRole: "hero",
    icon: "Briefcase",
  },
} as const;

export const LAYOUT_TEMPLATE_IDS = Object.keys(LAYOUT_TEMPLATES) as LayoutTemplate[];
