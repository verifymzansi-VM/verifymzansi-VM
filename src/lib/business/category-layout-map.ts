/* ══════════════════════════════════════════════════════════════
   Category → Layout Template Default Mapping
   Maps each business category to its recommended layout.
   Businesses can override this by setting layout_template.
   ══════════════════════════════════════════════════════════════ */

import type { BusinessCategory } from "@/types/enums";
import type { LayoutTemplate } from "./layout-templates";

/**
 * Recommended default layout for each business category.
 *
 * - **cinematic**  — visual-heavy, video-hero, emotional first impression
 * - **showcase**   — gallery-first, product-focused media grid
 * - **professional** — info-first, structured credentials layout
 */
export const CATEGORY_LAYOUT_MAP: Record<BusinessCategory, LayoutTemplate> = {
  health_medical: "professional",
  beauty_personal: "professional",
  fitness_wellness: "professional",
  cleaning_garden: "professional",
  automotive_services: "professional",
  transport_storage: "professional",
  pets_animals: "professional",
  community_personal: "professional",

  fashion_accessories: "cinematic",
  health_beauty: "cinematic",
  food_dining: "cinematic",
  events_entertainment: "cinematic",

  electronics_tech: "showcase",
  groceries_essentials: "showcase",
  home_living: "showcase",
  automotive_transport: "showcase",

  trade_maintenance: "professional",
  professional_services: "professional",
  education_training: "professional",
  general_other: "professional",

  tourism_hospitality: "cinematic",
};

/**
 * Category-specific CTA labels that enhance the profile per category.
 * These adjust action buttons and section headings to feel tailored.
 */
export const CATEGORY_CTA_CONFIG: Record<
  BusinessCategory,
  {
    primaryCta?: string;
    servicesHeading: string;
    galleryHeading: string;
  }
> = {
  health_medical: { servicesHeading: "Products & services", galleryHeading: "Photos" },
  beauty_personal: { servicesHeading: "Products & services", galleryHeading: "Photos" },
  fitness_wellness: { servicesHeading: "Products & services", galleryHeading: "Photos" },
  cleaning_garden: { servicesHeading: "Products & services", galleryHeading: "Photos" },
  automotive_services: { servicesHeading: "Products & services", galleryHeading: "Photos" },
  transport_storage: { servicesHeading: "Products & services", galleryHeading: "Photos" },
  pets_animals: { servicesHeading: "Products & services", galleryHeading: "Photos" },
  community_personal: { servicesHeading: "Products & services", galleryHeading: "Photos" },

  fashion_accessories: {
    primaryCta: "Shop collection",
    servicesHeading: "Our range",
    galleryHeading: "Style gallery",
  },
  electronics_tech: {
    primaryCta: "View products",
    servicesHeading: "Products & services",
    galleryHeading: "Product gallery",
  },
  groceries_essentials: {
    primaryCta: "Shop now",
    servicesHeading: "What we stock",
    galleryHeading: "Store gallery",
  },
  health_beauty: {
    primaryCta: "Book appointment",
    servicesHeading: "Our treatments",
    galleryHeading: "Portfolio",
  },
  home_living: {
    primaryCta: "Browse products",
    servicesHeading: "Products & services",
    galleryHeading: "Showroom",
  },
  food_dining: {
    primaryCta: "Order now",
    servicesHeading: "Our menu",
    galleryHeading: "Food gallery",
  },
  trade_maintenance: {
    primaryCta: "Request a quote",
    servicesHeading: "Services we offer",
    galleryHeading: "Our work",
  },
  professional_services: {
    primaryCta: "Get in touch",
    servicesHeading: "Our services",
    galleryHeading: "Portfolio",
  },
  education_training: {
    primaryCta: "Enrol now",
    servicesHeading: "Courses & programmes",
    galleryHeading: "Campus gallery",
  },
  events_entertainment: {
    primaryCta: "Book tickets",
    servicesHeading: "What we offer",
    galleryHeading: "Event gallery",
  },
  automotive_transport: {
    primaryCta: "Get a quote",
    servicesHeading: "Services",
    galleryHeading: "Workshop gallery",
  },
  general_other: {
    primaryCta: "Contact us",
    servicesHeading: "Services offered",
    galleryHeading: "Photos",
  },
  tourism_hospitality: {
    primaryCta: "Book now",
    servicesHeading: "What we offer",
    galleryHeading: "Photo gallery",
  },
};

/** Resolve the effective layout for a business (explicit choice > category default > fallback). */
export function resolveBusinessLayout(
  layoutTemplate: string | null | undefined,
  category: BusinessCategory | string
): LayoutTemplate {
  if (
    layoutTemplate === "cinematic" ||
    layoutTemplate === "showcase" ||
    layoutTemplate === "professional"
  ) {
    return layoutTemplate;
  }
  return CATEGORY_LAYOUT_MAP[category as BusinessCategory] ?? "professional";
}
