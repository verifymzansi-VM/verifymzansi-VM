import {
  MALL_SHOP_CATEGORY_LABELS,
  BUSINESS_AD_CATEGORY_LABELS,
  type ListingCategory,
  type MallShopCategory,
  type BusinessAdCategory,
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
  Dumbbell,
  CalendarDays,
  Landmark,
  GraduationCap,
  Heart,
  Store,
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
  options?: string[];
  placeholder?: string;
  unit?: string;
  /** For cascading selects: name of the parent field this depends on (e.g. model depends on make) */
  dependsOn?: string;
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    value: "property",
    label: "Property (For Sale & To Rent)",
    icon: Building2,
    description: "Houses, apartments, commercial space, and land.",
    attributeFields: [
      {
        name: "listing_type",
        label: "For Sale / To Rent",
        type: "select",
        required: true,
        options: ["For Sale", "To Rent"],
      },
      {
        name: "property_type",
        label: "Property Type",
        type: "select",
        required: true,
        options: [
          "House",
          "Apartment / Flat",
          "Townhouse",
          "Cluster Home",
          "Simplex",
          "Duplex",
          "Vacant Land / Plot",
          "Farm / Smallholding",
          "Room to Rent",
          "Commune",
          "Office Space",
          "Retail Store",
          "Industrial / Warehouse",
          "Commercial Land",
          "Hospitality",
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
        name: "garages",
        label: "Garages",
        type: "number",
        required: false,
      },
      {
        name: "parking",
        label: "Parking Spaces (Open)",
        type: "number",
        required: false,
      },
      {
        name: "erf_size",
        label: "Erf Size (Stand Size)",
        type: "number",
        required: false,
        unit: "m²",
      },
      {
        name: "floor_size",
        label: "Floor / Building Size",
        type: "number",
        required: false,
        unit: "m²",
      },
      {
        name: "levies",
        label: "Monthly Levies",
        type: "number",
        required: false,
        unit: "ZAR",
      },
      {
        name: "rates_taxes",
        label: "Rates and Taxes",
        type: "number",
        required: false,
        unit: "ZAR",
      },
      {
        name: "pet_friendly",
        label: "Pet Friendly",
        type: "boolean",
        required: false,
      },
      {
        name: "furnished",
        label: "Furnished",
        type: "boolean",
        required: false,
      },
      {
        name: "pool",
        label: "Swimming Pool",
        type: "boolean",
        required: false,
      },
      {
        name: "garden",
        label: "Garden",
        type: "boolean",
        required: false,
      },
      {
        name: "fiber_ready",
        label: "Fibre Ready",
        type: "boolean",
        required: false,
      },
      {
        name: "inverter_solar",
        label: "Inverter / Solar Output",
        type: "boolean",
        required: false,
      },
      {
        name: "security",
        label: "Security / Alarm",
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
        name: "vehicle_type",
        label: "Vehicle Type",
        type: "select",
        required: true,
        options: [
          "Passenger Car",
          "SUV / Crossover",
          "Bakkie (Single Cab)",
          "Bakkie (Super Cab / Extended)",
          "Bakkie (Double Cab)",
          "Minibus / Taxi",
          "Panel Van",
          "Truck",
          "Bus",
          "Motorcycle / Scooter",
          "Trailer",
          "Tractor / Plant / Agricultural",
        ],
      },
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
        name: "variant",
        label: "Variant / Trim",
        type: "text",
        required: false,
        placeholder: "e.g. 2.0 TDI Highline Auto",
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
        required: false,
        unit: "km",
      },
      {
        name: "condition",
        label: "Condition",
        type: "select",
        required: true,
        options: ["New", "Used", "Demo", "Code 2", "Code 3 (Rebuilt)"],
      },
      {
        name: "transmission",
        label: "Transmission",
        type: "select",
        required: false,
        options: ["Manual", "Automatic", "Semi-Automatic / DSG"],
      },
      {
        name: "fuel_type",
        label: "Fuel Type",
        type: "select",
        required: false,
        options: ["Petrol", "Diesel", "Electric", "Hybrid"],
      },
      {
        name: "body_type",
        label: "Body Type",
        type: "select",
        required: false,
        options: [
          "Hatchback",
          "Sedan",
          "SUV",
          "Coupe",
          "Cabriolet / Convertible",
          "Station Wagon",
          "Minibus",
        ],
      },
      {
        name: "colour",
        label: "Colour",
        type: "text",
        required: false,
      },
      {
        name: "service_history",
        label: "Service History",
        type: "select",
        required: false,
        options: [
          "Full Franchise Service History",
          "Partial Service History",
          "No Service History",
          "Not Applicable",
        ],
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
          "Engine & Drivetrain",
          "Body Parts & Glass",
          "Electrical & Lighting",
          "Suspension & Steering",
          "Brakes",
          "Tyres, Mags & Rims",
          "Interior Components",
          "Car Audio & Security",
          "Tools & Equipment",
          "Other Auto Accessories",
        ],
      },
      {
        name: "condition",
        label: "Condition",
        type: "select",
        required: true,
        options: ["New", "Used - Excellent", "Used - Good", "For Spares/Repairs"],
      },
      {
        name: "compatible_make",
        label: "Compatible Make(s)",
        type: "text",
        required: false,
        placeholder: "e.g. Universal, VW, Toyota",
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
        options: [
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
        ],
      },
      {
        name: "brand",
        label: "Brand",
        type: "text",
        required: true,
        placeholder: "e.g. Apple, Samsung, Dell",
      },
      {
        name: "model",
        label: "Model",
        type: "text",
        required: true,
      },
      {
        name: "storage",
        label: "Storage Capacity",
        type: "select",
        required: false,
        options: ["16GB", "32GB", "64GB", "128GB", "256GB", "512GB", "1TB", "2TB+"],
      },
      {
        name: "condition",
        label: "Condition",
        type: "select",
        required: true,
        options: [
          "Brand New - Sealed",
          "Brand New - Open Box",
          "Used - Like New (No scratches)",
          "Used - Good (Minor wear)",
          "Used - Fair (Visible scratches)",
          "For Parts / Broken",
        ],
      },
      {
        name: "battery_health",
        label: "Battery Health %",
        type: "number",
        required: false,
      },
      {
        name: "warranty",
        label: "Includes Warranty",
        type: "boolean",
        required: false,
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
        name: "category",
        label: "Category",
        type: "select",
        required: true,
        options: [
          "Furniture & Decor",
          "Home Appliances",
          "Garden & Outdoor",
          "Fashion, Shoes & Beauty",
          "Sports, Fitness & Outdoors",
          "Baby & Kids",
          "Pets & Animals",
          "Books, Music & Media",
          "Art & Collectibles",
          "Other",
        ],
      },
      {
        name: "condition",
        label: "Condition",
        type: "select",
        required: true,
        options: ["New", "Used - Like New", "Used - Good", "Used - Fair"],
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
        name: "subcategory",
        label: "Category",
        type: "select",
        required: true,
        options: [
          "Job Opportunity (Full/Part Time)",
          "Trades (Plumber, Builder, Electrician)",
          "Professional Services (Legal, Accounting)",
          "Creative & IT Services",
          "Cleaning & Domestic",
          "Moving & Transport",
          "Events & Catering",
          "Health & Wellness",
          "Free Stuff",
          "Miscellaneous",
        ],
      },
      {
        name: "salary_rate",
        label: "Salary / Rate",
        type: "text",
        required: false,
        placeholder: "e.g. R350/hr or R15k/month",
      },
      {
        name: "call_out_fee",
        label: "Call-out Fee (Trades)",
        type: "number",
        required: false,
        unit: "ZAR",
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

export const MALL_SHOP_CATEGORIES: {
  value: MallShopCategory;
  label: string;
  icon: LucideIcon;
  description: string;
}[] = [
  {
    value: "mall_fashion",
    label: MALL_SHOP_CATEGORY_LABELS.mall_fashion,
    icon: Shirt,
    description: "Clothing, shoes, jewelry, bags.",
  },
  {
    value: "mall_electronics",
    label: MALL_SHOP_CATEGORY_LABELS.mall_electronics,
    icon: Smartphone,
    description: "Mobile phones, computers, gaming, tech gadgets.",
  },
  {
    value: "mall_groceries",
    label: MALL_SHOP_CATEGORY_LABELS.mall_groceries,
    icon: ShoppingCart,
    description: "Supermarkets, convenience stores, specialty foods.",
  },
  {
    value: "mall_health_beauty",
    label: MALL_SHOP_CATEGORY_LABELS.mall_health_beauty,
    icon: Sparkles,
    description: "Pharmacies, cosmetics, salons, spas.",
  },
  {
    value: "mall_home_decor",
    label: MALL_SHOP_CATEGORY_LABELS.mall_home_decor,
    icon: Sofa,
    description: "Appliances, interior decor, homeware.",
  },
  {
    value: "mall_sports_hobbies",
    label: MALL_SHOP_CATEGORY_LABELS.mall_sports_hobbies,
    icon: Dumbbell,
    description: "Athletic gear, outdoor equipment, books, toys.",
  },
  {
    value: "mall_dining",
    label: MALL_SHOP_CATEGORY_LABELS.mall_dining,
    icon: Utensils,
    description: "Restaurants, cafés, fast food, bakeries.",
  },
  {
    value: "mall_services",
    label: MALL_SHOP_CATEGORY_LABELS.mall_services,
    icon: Briefcase,
    description: "Optometrists, banks, travel agents, print shops.",
  },
];

export const BUSINESS_AD_CATEGORIES: {
  value: BusinessAdCategory;
  label: string;
  icon: LucideIcon;
  description: string;
}[] = [
  {
    value: "biz_events",
    label: BUSINESS_AD_CATEGORY_LABELS.biz_events,
    icon: CalendarDays,
    description: "Sports events, music concerts, markets, expos.",
  },
  {
    value: "biz_government",
    label: BUSINESS_AD_CATEGORY_LABELS.biz_government,
    icon: Landmark,
    description: "Municipal announcements, department notices.",
  },
  {
    value: "biz_home_trades",
    label: BUSINESS_AD_CATEGORY_LABELS.biz_home_trades,
    icon: Wrench,
    description: "Plumbers, electricians, builders, cleaning.",
  },
  {
    value: "biz_professional",
    label: BUSINESS_AD_CATEGORY_LABELS.biz_professional,
    icon: Briefcase,
    description: "Legal, accounting, marketing, IT, consulting.",
  },
  {
    value: "biz_education",
    label: BUSINESS_AD_CATEGORY_LABELS.biz_education,
    icon: GraduationCap,
    description: "Schools, universities, short courses, tutoring.",
  },
  {
    value: "biz_automotive",
    label: BUSINESS_AD_CATEGORY_LABELS.biz_automotive,
    icon: Car,
    description: "Mechanics, panel beaters, logistics, shuttles.",
  },
  {
    value: "biz_health",
    label: BUSINESS_AD_CATEGORY_LABELS.biz_health,
    icon: Heart,
    description: "Doctors, dentists, clinics, mental health.",
  },
  {
    value: "biz_general",
    label: BUSINESS_AD_CATEGORY_LABELS.biz_general,
    icon: Store,
    description: "Any general retail ads, notices, or other.",
  },
];
