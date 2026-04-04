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
  fashion_accessories: {
    primaryCta: "Shop Collection",
    servicesHeading: "Our Range",
    galleryHeading: "Style Gallery",
  },
  electronics_tech: {
    primaryCta: "View Products",
    servicesHeading: "Products & Services",
    galleryHeading: "Product Gallery",
  },
  groceries_essentials: {
    primaryCta: "Shop Now",
    servicesHeading: "What We Stock",
    galleryHeading: "Store Gallery",
  },
  health_beauty: {
    primaryCta: "Book Appointment",
    servicesHeading: "Our Treatments",
    galleryHeading: "Portfolio",
  },
  home_living: {
    primaryCta: "Browse Products",
    servicesHeading: "Products & Services",
    galleryHeading: "Showroom",
  },
  food_dining: {
    primaryCta: "Order Now",
    servicesHeading: "Our Menu",
    galleryHeading: "Food Gallery",
  },
  trade_maintenance: {
    primaryCta: "Request a Quote",
    servicesHeading: "Services We Offer",
    galleryHeading: "Our Work",
  },
  professional_services: {
    primaryCta: "Get in Touch",
    servicesHeading: "Our Services",
    galleryHeading: "Portfolio",
  },
  education_training: {
    primaryCta: "Enroll Now",
    servicesHeading: "Courses & Programs",
    galleryHeading: "Campus Gallery",
  },
  events_entertainment: {
    primaryCta: "Book Tickets",
    servicesHeading: "What We Offer",
    galleryHeading: "Event Gallery",
  },
  automotive_transport: {
    primaryCta: "Get a Quote",
    servicesHeading: "Services",
    galleryHeading: "Workshop Gallery",
  },
  general_other: {
    primaryCta: "Contact Us",
    servicesHeading: "Services Offered",
    galleryHeading: "Photos",
  },
  tourism_hospitality: {
    primaryCta: "Book Now",
    servicesHeading: "What We Offer",
    galleryHeading: "Photo Gallery",
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
