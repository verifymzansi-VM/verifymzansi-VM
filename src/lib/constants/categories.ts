import {
  BUSINESS_CATEGORY_LABELS,
  type ListingCategory,
  type BusinessCategory,
  type BusinessType,
} from "@/types/enums";
import { getVehicleMakeNames } from "@/lib/constants/sa-vehicles";
import {
  Building2,
  Car,
  Wrench,
  Smartphone,
  Sofa,
  Briefcase,
  Shirt,
  ShoppingCart,
  Sparkles,
  Utensils,
  CalendarDays,
  GraduationCap,
  Store,
  Home,
  MapPin,
  Globe,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";

export interface CategoryDefinition {
  value: ListingCategory;
  label: string;
  icon: LucideIcon;
  description: string;
  attributeFields: AttributeField[];
}

export interface AttributeField {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "boolean";
  required: boolean;
  options?: Array<string | { value: string; label: string }>;
  placeholder?: string;
  unit?: string;
  /** For cascading selects: name of the parent field this depends on (e.g. model depends on make) */
  dependsOn?: string;
}

export const ELECTRONICS_DEVICE_TYPES = [
  "Smartphone",
  "Tablet / iPad",
  "Laptop",
  "Desktop PC",
  "Gaming Console",
  "Video Games",
  "Monitors & TVs",
  "PC Components",
  "Smartwatch / Wearable",
  "Audio & Headphones",
  "Cameras & Drones",
  "Accessories",
] as const;

export const CATEGORIES: CategoryDefinition[] = [
  {
    value: "property",
    label: "Property (For Sale & To Rent)",
    icon: Building2,
    description: "Houses, apartments, commercial space, and land.",
    attributeFields: [
      {
        name: "property_type",
        label: "Property Type",
        type: "select",
        required: true,
        options: [
          { value: "house", label: "House" },
          { value: "apartment", label: "Apartment / Flat" },
          { value: "land", label: "Land / Plot" },
          { value: "commercial", label: "Commercial" },
          { value: "room", label: "Room" },
        ],
      },
      {
        name: "bedrooms",
        label: "Bedrooms",
        type: "number",
        required: false,
      },
      {
        name: "bathrooms",
        label: "Bathrooms",
        type: "number",
        required: false,
      },
      {
        name: "parking_spots",
        label: "Parking Spaces",
        type: "number",
        required: false,
      },
      {
        name: "size_sqm",
        label: "Size",
        type: "number",
        required: false,
        unit: "m²",
      },
      {
        name: "furnished",
        label: "Furnished",
        type: "boolean",
        required: false,
      },
      {
        name: "pets_allowed",
        label: "Pets Allowed",
        type: "boolean",
        required: false,
      },
    ],
  },
  {
    value: "vehicles",
    label: "Vehicles (Cars, Bakkies & Commercial)",
    icon: Car,
    description: "Passenger cars, SUVs, bakkies, trucks, and bikes.",
    attributeFields: [
      {
        name: "make",
        label: "Make",
        type: "select",
        required: true,
        options: getVehicleMakeNames(),
      },
      {
        name: "model",
        label: "Model",
        type: "select",
        required: true,
        dependsOn: "make",
        options: [], // populated dynamically based on selected make
      },
      {
        name: "year",
        label: "Year",
        type: "number",
        required: true,
      },
      {
        name: "mileage_km",
        label: "Mileage",
        type: "number",
        required: true,
        unit: "km",
      },
      {
        name: "transmission",
        label: "Transmission",
        type: "select",
        required: true,
        options: [
          { value: "manual", label: "Manual" },
          { value: "automatic", label: "Automatic" },
        ],
      },
      {
        name: "fuel_type",
        label: "Fuel Type",
        type: "select",
        required: true,
        options: [
          { value: "petrol", label: "Petrol" },
          { value: "diesel", label: "Diesel" },
          { value: "electric", label: "Electric" },
          { value: "hybrid", label: "Hybrid" },
        ],
      },
      {
        name: "body_type",
        label: "Body Type",
        type: "select",
        required: false,
        options: [
          { value: "hatchback", label: "Hatchback" },
          { value: "sedan", label: "Sedan" },
          { value: "suv", label: "SUV" },
          { value: "bakkie", label: "Bakkie" },
          { value: "van", label: "Van" },
          { value: "coupe", label: "Coupe" },
          { value: "other", label: "Other" },
        ],
      },
      {
        name: "colour",
        label: "Colour",
        type: "text",
        required: false,
      },
    ],
  },
  {
    value: "auto_parts",
    label: "Auto Parts & Accessories",
    icon: Wrench,
    description: "Vehicle parts, spares, tools, alloys, and sound systems.",
    attributeFields: [
      {
        name: "part_type",
        label: "Part Type",
        type: "select",
        required: true,
        options: [
          "engine",
          "body",
          "electrical",
          "suspension",
          "brakes",
          "wheels",
          "interior",
          "audio",
          "tools",
          "other",
        ],
      },
      {
        name: "compatible_make",
        label: "Compatible Make(s)",
        type: "text",
        required: false,
        placeholder: "e.g. Universal, VW, Toyota",
      },
      {
        name: "compatible_model",
        label: "Compatible Model(s)",
        type: "text",
        required: false,
        placeholder: "e.g. Polo, Hilux",
      },
      {
        name: "oem_or_aftermarket",
        label: "OEM or Aftermarket",
        type: "select",
        required: false,
        options: [
          { value: "oem", label: "OEM" },
          { value: "aftermarket", label: "Aftermarket" },
        ],
      },
    ],
  },
  {
    value: "electronics",
    label: "Electronics & Tech",
    icon: Smartphone,
    description: "Phones, laptops, gaming consoles, TVs, and gadgets.",
    attributeFields: [
      {
        name: "device_type",
        label: "Device Type",
        type: "select",
        required: true,
        options: [...ELECTRONICS_DEVICE_TYPES],
      },
      {
        name: "brand",
        label: "Brand",
        type: "text",
        required: true,
        placeholder: "e.g. Apple, Samsung, Dell",
      },
      {
        name: "model_name",
        label: "Model",
        type: "text",
        required: false,
      },
      {
        name: "storage_gb",
        label: "Storage Capacity",
        type: "number",
        required: false,
        unit: "GB",
      },
      {
        name: "screen_size_inches",
        label: "Screen Size",
        type: "number",
        required: false,
        unit: "in",
      },
      {
        name: "warranty_months",
        label: "Warranty",
        type: "number",
        required: false,
        unit: "months",
      },
    ],
  },
  {
    value: "home_lifestyle",
    label: "Home & Lifestyle",
    icon: Sofa,
    description: "Furniture, appliances, fashion, sports, pets, and baby items.",
    attributeFields: [
      {
        name: "sub_category",
        label: "Category",
        type: "select",
        required: false,
        options: [
          { value: "furniture", label: "Furniture & Decor" },
          { value: "appliances", label: "Home Appliances" },
          { value: "garden", label: "Garden & Outdoor" },
          { value: "decor", label: "Decor" },
          { value: "clothing", label: "Clothing & Beauty" },
          { value: "other", label: "Other" },
        ],
      },
      {
        name: "material",
        label: "Material",
        type: "text",
        required: false,
        placeholder: "e.g. Leather, Wood, Cotton",
      },
    ],
  },
  {
    value: "jobs_services",
    label: "Jobs, Services & Other",
    icon: Briefcase,
    description: "Job vacancies, professional services, tradesmen, and events.",
    attributeFields: [
      {
        name: "job_type",
        label: "Category",
        type: "select",
        required: true,
        options: [
          { value: "full_time", label: "Full Time" },
          { value: "part_time", label: "Part Time" },
          { value: "contract", label: "Contract" },
          { value: "freelance", label: "Freelance" },
        ],
      },
      {
        name: "remote",
        label: "Remote Friendly",
        type: "boolean",
        required: false,
      },
      {
        name: "salary_range",
        label: "Salary / Rate",
        type: "text",
        required: false,
        placeholder: "e.g. R350/hr or R15k/month",
      },
    ],
  },
];

/**
 * Get a category by its value.
 */
export function getCategory(value: ListingCategory): CategoryDefinition | undefined {
  return CATEGORIES.find((c) => c.value === value);
}

/* ── Mzansi Business Categories (unified) ────────────────── */
export interface BusinessCategoryDefinition {
  value: BusinessCategory;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const BUSINESS_CATEGORIES: BusinessCategoryDefinition[] = [
  {
    value: "fashion_accessories",
    label: BUSINESS_CATEGORY_LABELS.fashion_accessories,
    icon: Shirt,
    description: "Clothing, shoes, jewelry, bags, accessories.",
  },
  {
    value: "electronics_tech",
    label: BUSINESS_CATEGORY_LABELS.electronics_tech,
    icon: Smartphone,
    description: "Mobile phones, computers, gaming, tech gadgets.",
  },
  {
    value: "groceries_essentials",
    label: BUSINESS_CATEGORY_LABELS.groceries_essentials,
    icon: ShoppingCart,
    description: "Supermarkets, convenience stores, specialty foods.",
  },
  {
    value: "health_beauty",
    label: BUSINESS_CATEGORY_LABELS.health_beauty,
    icon: Sparkles,
    description: "Pharmacies, cosmetics, salons, spas, clinics.",
  },
  {
    value: "home_living",
    label: BUSINESS_CATEGORY_LABELS.home_living,
    icon: Sofa,
    description: "Furniture, appliances, interior decor, homeware.",
  },
  {
    value: "food_dining",
    label: BUSINESS_CATEGORY_LABELS.food_dining,
    icon: Utensils,
    description: "Restaurants, cafés, fast food, bakeries, catering.",
  },
  {
    value: "trade_maintenance",
    label: BUSINESS_CATEGORY_LABELS.trade_maintenance,
    icon: Wrench,
    description: "Plumbers, electricians, builders, cleaning, repairs.",
  },
  {
    value: "professional_services",
    label: BUSINESS_CATEGORY_LABELS.professional_services,
    icon: Briefcase,
    description: "Legal, accounting, marketing, IT, consulting.",
  },
  {
    value: "education_training",
    label: BUSINESS_CATEGORY_LABELS.education_training,
    icon: GraduationCap,
    description: "Schools, tutoring, short courses, universities.",
  },
  {
    value: "events_entertainment",
    label: BUSINESS_CATEGORY_LABELS.events_entertainment,
    icon: CalendarDays,
    description: "Events, concerts, markets, expos, entertainment.",
  },
  {
    value: "automotive_transport",
    label: BUSINESS_CATEGORY_LABELS.automotive_transport,
    icon: Car,
    description: "Mechanics, panel beaters, logistics, shuttles.",
  },
  {
    value: "general_other",
    label: BUSINESS_CATEGORY_LABELS.general_other,
    icon: Store,
    description: "General retail, notices, or other businesses.",
  },
];

export interface BusinessTypeOption {
  value: BusinessType;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const BUSINESS_TYPE_OPTIONS: BusinessTypeOption[] = [
  {
    value: "mall_store",
    label: "Mall Store",
    icon: ShoppingBag,
    description: "A shop located inside a shopping mall or centre.",
  },
  {
    value: "standalone_shop",
    label: "Standalone Shop",
    icon: Store,
    description: "A brick-and-mortar shop with its own physical location.",
  },
  {
    value: "home_business",
    label: "Home Business",
    icon: Home,
    description: "A business operating from a residential address.",
  },
  {
    value: "mobile_service",
    label: "Mobile Service",
    icon: MapPin,
    description: "A service provider that travels to clients (plumber, electrician, etc.).",
  },
  {
    value: "online_only",
    label: "Online Only",
    icon: Globe,
    description: "A business with no physical storefront — online or social media only.",
  },
  {
    value: "market_stall",
    label: "Market Stall",
    icon: Building2,
    description: "A stall at a flea market, farmers market, or community market.",
  },
];
