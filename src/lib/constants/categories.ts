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
  TreePalm,
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
        type: "select",
        required: false,
        options: [
          { value: "White", label: "White" },
          { value: "Black", label: "Black" },
          { value: "Silver", label: "Silver" },
          { value: "Grey", label: "Grey" },
          { value: "Blue", label: "Blue" },
          { value: "Red", label: "Red" },
          { value: "Brown", label: "Brown" },
          { value: "Gold", label: "Gold" },
          { value: "Green", label: "Green" },
          { value: "Orange", label: "Orange" },
          { value: "Yellow", label: "Yellow" },
          { value: "Maroon", label: "Maroon" },
          { value: "Beige", label: "Beige" },
          { value: "Other", label: "Other" },
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
        type: "select",
        required: false,
        options: [
          { value: "Wood", label: "Wood" },
          { value: "Leather", label: "Leather" },
          { value: "Fabric", label: "Fabric" },
          { value: "Metal", label: "Metal" },
          { value: "Glass", label: "Glass" },
          { value: "Plastic", label: "Plastic" },
          { value: "Cotton", label: "Cotton" },
          { value: "Ceramic", label: "Ceramic" },
          { value: "Stone", label: "Stone" },
          { value: "Other", label: "Other" },
        ],
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
export interface BusinessSubcategoryOption {
  value: string;
  label: string;
}

export interface BusinessCategoryDefinition {
  value: BusinessCategory;
  label: string;
  icon: LucideIcon;
  description: string;
  subcategories: BusinessSubcategoryOption[];
  serviceSuggestions: string[];
}

export const BUSINESS_CATEGORIES: BusinessCategoryDefinition[] = [
  {
    value: "fashion_accessories",
    label: BUSINESS_CATEGORY_LABELS.fashion_accessories,
    icon: Shirt,
    description: "Clothing, shoes, jewelry, bags, accessories.",
    subcategories: [
      { value: "clothing_store", label: "Clothing Store" },
      { value: "shoe_store", label: "Shoe Store" },
      { value: "jewelry_watches", label: "Jewelry & Watches" },
      { value: "bags_luggage", label: "Bags & Luggage" },
      { value: "tailoring_alterations", label: "Tailoring & Alterations" },
      { value: "thrift_vintage", label: "Thrift / Vintage" },
      { value: "general_accessories", label: "General Accessories" },
    ],
    serviceSuggestions: [
      "Custom tailoring",
      "Alterations",
      "Personal styling",
      "Online orders",
      "Gift wrapping",
      "Layby",
    ],
  },
  {
    value: "electronics_tech",
    label: BUSINESS_CATEGORY_LABELS.electronics_tech,
    icon: Smartphone,
    description: "Mobile phones, computers, gaming, tech gadgets.",
    subcategories: [
      { value: "mobile_phone_shop", label: "Mobile Phone Shop" },
      { value: "computer_it", label: "Computer & IT Store" },
      { value: "gaming", label: "Gaming" },
      { value: "appliance_repair", label: "Appliance Repair" },
      { value: "audio_visual", label: "Audio & Visual" },
      { value: "general_electronics", label: "General Electronics" },
    ],
    serviceSuggestions: [
      "Phone repairs",
      "Screen replacement",
      "Data recovery",
      "Software installation",
      "Tech support",
      "Trade-ins",
    ],
  },
  {
    value: "groceries_essentials",
    label: BUSINESS_CATEGORY_LABELS.groceries_essentials,
    icon: ShoppingCart,
    description: "Supermarkets, convenience stores, specialty foods.",
    subcategories: [
      { value: "supermarket", label: "Supermarket" },
      { value: "spaza_convenience", label: "Spaza / Convenience Shop" },
      { value: "butchery", label: "Butchery" },
      { value: "bakery_retail", label: "Bakery (Retail)" },
      { value: "fruit_veg", label: "Fruit & Veg" },
      { value: "specialty_organic", label: "Specialty / Organic" },
      { value: "liquor_store", label: "Liquor Store" },
    ],
    serviceSuggestions: [
      "Home delivery",
      "Bulk orders",
      "Fresh produce",
      "Pre-packed meals",
      "Loyalty card",
      "Cash on delivery",
    ],
  },
  {
    value: "health_beauty",
    label: BUSINESS_CATEGORY_LABELS.health_beauty,
    icon: Sparkles,
    description: "Pharmacies, cosmetics, salons, spas, clinics.",
    subcategories: [
      { value: "doctor_medical", label: "Doctor / Medical Practice" },
      { value: "dentist", label: "Dentist" },
      { value: "optometrist", label: "Optometrist" },
      { value: "pharmacy", label: "Pharmacy / Chemist" },
      { value: "hair_salon_barber", label: "Hair Salon / Barbershop" },
      { value: "beauty_nail_salon", label: "Beauty & Nail Salon" },
      { value: "spa_wellness", label: "Spa & Wellness" },
      { value: "gym_fitness", label: "Gym / Fitness Studio" },
      { value: "physio_chiro", label: "Physiotherapy / Chiropractic" },
      { value: "traditional_healer", label: "Traditional Healer" },
      { value: "mental_health", label: "Mental Health / Counselling" },
    ],
    serviceSuggestions: [
      "Consultations",
      "Check-ups",
      "Haircut",
      "Braids",
      "Manicure",
      "Pedicure",
      "Facial",
      "Massage",
      "Waxing",
      "Medical aid accepted",
    ],
  },
  {
    value: "home_living",
    label: BUSINESS_CATEGORY_LABELS.home_living,
    icon: Sofa,
    description: "Furniture, appliances, interior decor, homeware.",
    subcategories: [
      { value: "furniture_store", label: "Furniture Store" },
      { value: "interior_decor", label: "Interior Decor" },
      { value: "hardware_diy", label: "Hardware / DIY" },
      { value: "garden_outdoor", label: "Garden & Outdoor" },
      { value: "appliance_store", label: "Appliance Store" },
      { value: "linen_homeware", label: "Linen & Homeware" },
    ],
    serviceSuggestions: [
      "Delivery",
      "Installation",
      "Custom orders",
      "Layby",
      "Interior design consultation",
    ],
  },
  {
    value: "food_dining",
    label: BUSINESS_CATEGORY_LABELS.food_dining,
    icon: Utensils,
    description: "Restaurants, cafés, fast food, bakeries, catering.",
    subcategories: [
      { value: "restaurant", label: "Restaurant" },
      { value: "cafe_coffee", label: "Café / Coffee Shop" },
      { value: "fast_food_takeaway", label: "Fast Food / Takeaway" },
      { value: "bakery_patisserie", label: "Bakery & Patisserie" },
      { value: "catering", label: "Catering" },
      { value: "food_truck", label: "Food Truck" },
      { value: "shisanyama_braai", label: "Shisanyama / Braai" },
      { value: "bar_lounge", label: "Bar / Lounge" },
    ],
    serviceSuggestions: [
      "Dine-in",
      "Takeaway",
      "Delivery",
      "Catering",
      "Functions",
      "Halal",
      "Vegan options",
      "Kids menu",
    ],
  },
  {
    value: "trade_maintenance",
    label: BUSINESS_CATEGORY_LABELS.trade_maintenance,
    icon: Wrench,
    description: "Plumbers, electricians, builders, cleaning, repairs.",
    subcategories: [
      { value: "plumber", label: "Plumber" },
      { value: "electrician", label: "Electrician" },
      { value: "builder_contractor", label: "Builder / Contractor" },
      { value: "painter", label: "Painter" },
      { value: "cleaning_service", label: "Cleaning Service" },
      { value: "locksmith", label: "Locksmith" },
      { value: "pest_control", label: "Pest Control" },
      { value: "handyman", label: "Handyman / General Repairs" },
      { value: "landscaping", label: "Landscaping / Garden Service" },
      { value: "hvac_aircon", label: "HVAC / Air Conditioning" },
    ],
    serviceSuggestions: [
      "Free quotes",
      "Emergency callouts",
      "Residential",
      "Commercial",
      "Renovations",
      "Maintenance contracts",
    ],
  },
  {
    value: "professional_services",
    label: BUSINESS_CATEGORY_LABELS.professional_services,
    icon: Briefcase,
    description: "Legal, accounting, marketing, IT, consulting.",
    subcategories: [
      { value: "attorney_legal", label: "Attorney / Legal" },
      { value: "accounting_bookkeeping", label: "Accounting / Bookkeeping" },
      { value: "marketing_advertising", label: "Marketing / Advertising" },
      { value: "it_software", label: "IT / Software" },
      { value: "hr_recruitment", label: "HR / Recruitment" },
      { value: "real_estate", label: "Real Estate Agent" },
      { value: "insurance_broker", label: "Insurance Broker" },
      { value: "financial_advisor", label: "Financial Advisor" },
      { value: "consulting_general", label: "Consulting (General)" },
      { value: "notary", label: "Notary / Commissioner of Oaths" },
    ],
    serviceSuggestions: [
      "Consultations",
      "Tax returns",
      "Contracts",
      "Compliance",
      "Business registration",
      "Virtual meetings",
    ],
  },
  {
    value: "education_training",
    label: BUSINESS_CATEGORY_LABELS.education_training,
    icon: GraduationCap,
    description: "Schools, tutoring, short courses, universities.",
    subcategories: [
      { value: "school", label: "School (Primary / Secondary)" },
      { value: "creche_daycare", label: "Crèche / Day Care" },
      { value: "tutoring", label: "Tutoring" },
      { value: "driving_school", label: "Driving School" },
      { value: "skills_training", label: "Short Courses / Skills Training" },
      { value: "college_university", label: "College / University" },
      { value: "music_art_school", label: "Music / Art School" },
    ],
    serviceSuggestions: [
      "Private lessons",
      "Group classes",
      "Online learning",
      "Certification",
      "After-school care",
      "Holiday programmes",
    ],
  },
  {
    value: "events_entertainment",
    label: BUSINESS_CATEGORY_LABELS.events_entertainment,
    icon: CalendarDays,
    description: "Events, concerts, markets, expos, entertainment.",
    subcategories: [
      { value: "event_planner", label: "Event Planner / Coordinator" },
      { value: "dj_live_music", label: "DJ / Live Music" },
      { value: "photographer_videographer", label: "Photographer / Videographer" },
      { value: "venue_hire", label: "Venue Hire" },
      { value: "decor_hiring", label: "Décor & Hiring" },
      { value: "kids_entertainment", label: "Kids Entertainment" },
      { value: "party_supplies", label: "Party Supplies" },
    ],
    serviceSuggestions: [
      "Weddings",
      "Corporate events",
      "Birthday parties",
      "Sound & lighting",
      "MC services",
      "Photo booth",
    ],
  },
  {
    value: "automotive_transport",
    label: BUSINESS_CATEGORY_LABELS.automotive_transport,
    icon: Car,
    description: "Mechanics, panel beaters, logistics, shuttles.",
    subcategories: [
      { value: "car_dealer_new", label: "Car Dealer (New)" },
      { value: "car_dealer_used", label: "Car Dealer (Used / Pre-Owned)" },
      { value: "mechanic_workshop", label: "Mechanic / Workshop" },
      { value: "panel_beater", label: "Panel Beater / Body Shop" },
      { value: "auto_electrician", label: "Auto Electrician" },
      { value: "tyre_shop", label: "Tyre Shop" },
      { value: "car_wash", label: "Car Wash" },
      { value: "car_audio_accessories", label: "Car Audio / Accessories" },
      { value: "towing_service", label: "Towing Service" },
      { value: "driving_school_auto", label: "Driving School" },
      { value: "courier_logistics", label: "Courier / Logistics" },
      { value: "shuttle_transport", label: "Shuttle / Transport Service" },
    ],
    serviceSuggestions: [
      "Engine repairs",
      "Brakes",
      "Suspension",
      "Oil change",
      "Wheel alignment",
      "Diagnostics",
      "Panel beating",
      "Spray painting",
    ],
  },
  {
    value: "general_other",
    label: BUSINESS_CATEGORY_LABELS.general_other,
    icon: Store,
    description: "General retail, notices, or other businesses.",
    subcategories: [
      { value: "general_retail", label: "General Retail" },
      { value: "community_notice", label: "Community Notice" },
      { value: "religious_org", label: "Religious Organisation" },
      { value: "ngo_npo", label: "NGO / NPO" },
      { value: "pet_services", label: "Pet Services" },
      { value: "funeral_services", label: "Funeral Services" },
      { value: "printing_signage", label: "Printing / Signage" },
      { value: "storage_warehousing", label: "Storage / Warehousing" },
      { value: "other", label: "Other" },
    ],
    serviceSuggestions: [],
  },
  {
    value: "tourism_hospitality",
    label: BUSINESS_CATEGORY_LABELS.tourism_hospitality,
    icon: TreePalm,
    description: "Hotels, lodges, guest houses, tour operators, safaris, and travel services.",
    subcategories: [
      { value: "hotel_resort", label: "Hotel / Resort" },
      { value: "guest_house_bnb", label: "Guest House / B&B" },
      { value: "lodge_game_lodge", label: "Lodge / Game Lodge" },
      { value: "backpackers_hostel", label: "Backpackers / Hostel" },
      { value: "self_catering", label: "Self-Catering" },
      { value: "tour_operator", label: "Tour Operator" },
      { value: "travel_agency", label: "Travel Agency" },
      { value: "safari_wildlife", label: "Safari & Wildlife" },
      { value: "adventure_activities", label: "Adventure Activities" },
      { value: "cultural_heritage", label: "Cultural & Heritage" },
      { value: "car_rental_tourism", label: "Car Rental (Tourism)" },
    ],
    serviceSuggestions: [
      "Airport transfers",
      "Game drives",
      "Guided tours",
      "Conference facilities",
      "Wedding venue",
      "Spa & wellness",
      "Swimming pool",
      "Free Wi-Fi",
      "Breakfast included",
      "Pet-friendly",
    ],
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
    label: "Own Premises",
    icon: Store,
    description: "A shop, office, practice, studio, or workshop with its own physical location.",
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
