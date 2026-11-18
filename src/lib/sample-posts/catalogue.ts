/**
 * Display-only sample posts.
 *
 * A short, static list of example posts shown in the showrooms so visitors can
 * see how the site looks. Each sample is presented as VerifyMzansi's own
 * display example: it names no business (the business line reads
 * "VerifyMzansi" with the site's shield), carries no trust badges, and its
 * Call and WhatsApp buttons reach VerifyMzansi (src/lib/sample-posts/contact.ts).
 *
 * Rules for entries (checked by `validateSamplePost` and its tests):
 * - No business names, people's names or contact details in any field.
 * - Media live in the public bucket as `media/samples/<slug>.mp4` and
 *   `media/samples/<slug>.webp`.
 * - Use the git-ignored `catalogue.local.json` (development only) to preview
 *   entries before they are committed.
 *
 * Everything is hidden until `SAMPLE_POSTS_ENABLED=true` is set on the
 * server. Staff can also remove one sample, and restore it, from the staff
 * area (/admin/sample-posts); the database keeps only that hide-list.
 *
 * This file is imported by the request proxy, so it stays dependency-light.
 */

/**
 * Where a sample appears. Market samples show in Mzansi Market, business
 * samples in Mzansi Business, tourism (places to stay and experiences) and
 * event samples in Tourism & Events. The home showroom shows them all.
 */
export type SamplePostArea = "market" | "business" | "tourism" | "event";

export interface SamplePostEntry {
  /** URL slug: lowercase words joined by hyphens (`/sample/<slug>`). */
  slug: string;
  area: SamplePostArea;
  /**
   * Market: a listing category. Business: a business category. Tourism: a
   * tourism activity (a place to stay or an experience). Event: an event type.
   */
  category: string;
  /** 5 to 100 characters, as for real posts. */
  title: string;
  /** 20 to 5000 characters, as for real posts. */
  description: string;
  province: string;
  city: string;
  /** Committed: `media/samples/<slug>.mp4`. Local preview: a file name in `public/sample-posts-local/`. */
  videoKey: string;
  /** Committed: `media/samples/<slug>.webp`. Local preview: a file name in `public/sample-posts-local/`. */
  posterKey: string;
  /**
   * Events only, optional: the day it takes place (YYYY-MM-DD). Once that day
   * has passed the date is no longer shown; the sample stays.
   */
  eventDate?: string;
  /**
   * Internal only, optional: whether the place was confirmed while preparing
   * the entry. Never shown and dropped when the entry is loaded.
   */
  locationConfirmed?: boolean;
}

/**
 * The committed samples: VerifyMzansi's own display examples, shown after the
 * real posts. Places are a town only where the video shows it; otherwise the
 * province or region.
 */
export const APPROVED_SAMPLE_POSTS: readonly SamplePostEntry[] = [
  // Mzansi Market
  {
    slug: "arabian-style-perfumes-shop-tour",
    area: "market",
    category: "other_items",
    title: "Arabian-style perfumes and fragrance oils",
    description:
      "A tour of a perfume shop showing Arabian-style perfumes, gift boxes and fragrance oils on display.",
    province: "KwaZulu-Natal",
    city: "KwaZulu-Natal",
    videoKey: "media/samples/arabian-style-perfumes-shop-tour.mp4",
    posterKey: "media/samples/arabian-style-perfumes-shop-tour.webp",
  },
  {
    slug: "bedroom-combo-lit-wardrobe-and-dresser",
    area: "market",
    category: "home_lifestyle",
    title: "Bedroom combo: lit wardrobe and dresser with mirror",
    description:
      "A bedroom combo made in a workshop: a tall wardrobe with glass doors and lights, and a chest of drawers with a mirror.",
    province: "KwaZulu-Natal",
    city: "KwaZulu-Natal",
    videoKey: "media/samples/bedroom-combo-lit-wardrobe-and-dresser.mp4",
    posterKey: "media/samples/bedroom-combo-lit-wardrobe-and-dresser.webp",
  },
  {
    slug: "boxed-iphones-richards-bay",
    area: "market",
    category: "electronics",
    title: "Boxed iPhones at an electronics shop",
    description: "An electronics shop shows boxed iPhones in several colours on its counter.",
    province: "KwaZulu-Natal",
    city: "Richards Bay",
    videoKey: "media/samples/boxed-iphones-richards-bay.mp4",
    posterKey: "media/samples/boxed-iphones-richards-bay.webp",
  },
  {
    slug: "family-home-in-secure-estate-montana-pretoria",
    area: "market",
    category: "property",
    title: "Three-bedroom family home in a secure estate",
    description:
      "A walk-through of a three-bedroom, two-bathroom family home with a double garage in a secure estate.",
    province: "Gauteng",
    city: "Pretoria",
    videoKey: "media/samples/family-home-in-secure-estate-montana-pretoria.mp4",
    posterKey: "media/samples/family-home-in-secure-estate-montana-pretoria.webp",
  },
  {
    slug: "family-home-with-sea-views",
    area: "market",
    category: "property",
    title: "Family home tour with sea views",
    description:
      "A tour of a light-filled family home with a garden, followed by an aerial view of the neighbourhood and the sea.",
    province: "Western Cape",
    city: "Western Cape coast",
    videoKey: "media/samples/family-home-with-sea-views.mp4",
    posterKey: "media/samples/family-home-with-sea-views.webp",
  },
  {
    slug: "four-bedroom-house-annlin-pretoria",
    area: "market",
    category: "property",
    title: "Four-bedroom house with double garage",
    description: "A walk-through of a four-bedroom, two-bathroom house with a double garage.",
    province: "Gauteng",
    city: "Pretoria",
    videoKey: "media/samples/four-bedroom-house-annlin-pretoria.mp4",
    posterKey: "media/samples/four-bedroom-house-annlin-pretoria.webp",
  },
  {
    slug: "hyundai-ix35-used-car-lot",
    area: "market",
    category: "vehicles",
    title: "Hyundai ix35 on a used-car lot",
    description:
      "A grey Hyundai ix35 with a nudge bar parked under shade nets on a used-car lot, with a look at the interior.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/hyundai-ix35-used-car-lot.mp4",
    posterKey: "media/samples/hyundai-ix35-used-car-lot.webp",
  },
  {
    slug: "ladies-shoulder-bags",
    area: "market",
    category: "clothing_accessories",
    title: "Ladies shoulder bags in blue and cream",
    description:
      "Two ladies shoulder bags shown up close, one in blue suede-look and one in cream, with knotted straps and a clasp.",
    province: "KwaZulu-Natal",
    city: "KwaZulu-Natal",
    videoKey: "media/samples/ladies-shoulder-bags.mp4",
    posterKey: "media/samples/ladies-shoulder-bags.webp",
  },
  {
    slug: "mercedes-benz-gle-coupe-walk-around",
    area: "market",
    category: "vehicles",
    title: "Mercedes-Benz GLE coupé showroom walk-around",
    description:
      "A salesman walks around a white Mercedes-Benz GLE coupé in a dealership showroom and shows the interior.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/mercedes-benz-gle-coupe-walk-around.mp4",
    posterKey: "media/samples/mercedes-benz-gle-coupe-walk-around.webp",
  },
  {
    slug: "ten-bedroom-investment-property-kloof",
    area: "market",
    category: "property",
    title: "Ten-bedroom investment property",
    description:
      "A walk-through of a large ten-bedroom property presented as an investment with rental income.",
    province: "KwaZulu-Natal",
    city: "Kloof",
    videoKey: "media/samples/ten-bedroom-investment-property-kloof.mp4",
    posterKey: "media/samples/ten-bedroom-investment-property-kloof.webp",
  },
  {
    slug: "three-bedroom-home-with-pool-hillcrest",
    area: "market",
    category: "property",
    title: "Three-bedroom home with pool and garden",
    description:
      "A tour of a three-bedroom, two-bathroom home in an estate, with a pool and a private garden.",
    province: "KwaZulu-Natal",
    city: "Hillcrest",
    videoKey: "media/samples/three-bedroom-home-with-pool-hillcrest.mp4",
    posterKey: "media/samples/three-bedroom-home-with-pool-hillcrest.webp",
  },
  {
    slug: "toyota-hilux-gr-sport-showroom",
    area: "market",
    category: "vehicles",
    title: "Toyota Hilux GR-Sport double cab in a showroom",
    description:
      "A grey Toyota Hilux GR-Sport double cab in a dealership showroom, with close-ups of the wheels, badges and cabin.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/toyota-hilux-gr-sport-showroom.mp4",
    posterKey: "media/samples/toyota-hilux-gr-sport-showroom.webp",
  },
  {
    slug: "volkswagen-polo-showroom-walk-around",
    area: "market",
    category: "vehicles",
    title: "Volkswagen Polo showroom walk-around",
    description:
      "A salesman presents a white Volkswagen Polo in a dealership showroom, inside and out.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/volkswagen-polo-showroom-walk-around.mp4",
    posterKey: "media/samples/volkswagen-polo-showroom-walk-around.webp",
  },
  // Mzansi Business
  {
    slug: "built-in-wardrobe-installation",
    area: "business",
    category: "trade_maintenance",
    title: "Built-in wardrobe installation with sliding doors",
    description:
      "A fitter shows a newly installed built-in wardrobe with sliding mirror doors, shelves and drawers.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/built-in-wardrobe-installation.mp4",
    posterKey: "media/samples/built-in-wardrobe-installation.webp",
  },
  {
    slug: "burger-line-up-at-a-grill-restaurant",
    area: "business",
    category: "food_dining",
    title: "Burger line-up at a grill restaurant",
    description:
      "A food creator works through a board of different burgers with chips at a grill restaurant.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/burger-line-up-at-a-grill-restaurant.mp4",
    posterKey: "media/samples/burger-line-up-at-a-grill-restaurant.webp",
  },
  {
    slug: "burger-platter-and-cocktails",
    area: "business",
    category: "food_dining",
    title: "Burger platter special and cocktails",
    description:
      "A food creator tries a restaurant platter of burgers, onion rings, chips and pasta, with a cocktail on the side.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/burger-platter-and-cocktails.mp4",
    posterKey: "media/samples/burger-platter-and-cocktails.webp",
  },
  {
    slug: "car-dealership-sales-consultant-introduction",
    area: "business",
    category: "automotive_services",
    title: "Car dealership sales consultant introduces the showroom",
    description:
      "A sales consultant at a car dealership introduces herself and the showroom, standing in front of a new Renault.",
    province: "KwaZulu-Natal",
    city: "KwaZulu-Natal",
    videoKey: "media/samples/car-dealership-sales-consultant-introduction.mp4",
    posterKey: "media/samples/car-dealership-sales-consultant-introduction.webp",
  },
  {
    slug: "coffee-shop-pastries-and-counter",
    area: "business",
    category: "food_dining",
    title: "Coffee shop pastries, doughnuts and menu board",
    description: "A coffee shop counter with pastries, doughnuts, muffins and a menu board.",
    province: "KwaZulu-Natal",
    city: "KwaZulu-Natal",
    videoKey: "media/samples/coffee-shop-pastries-and-counter.mp4",
    posterKey: "media/samples/coffee-shop-pastries-and-counter.webp",
  },
  {
    slug: "couples-spa-treatment-rooms-durban",
    area: "business",
    category: "beauty_personal",
    title: "Couples spa treatment rooms",
    description:
      "A tour of a couples spa: the lounge, a treatment room with rose petals and candles, and the foot spa chairs.",
    province: "KwaZulu-Natal",
    city: "Durban",
    videoKey: "media/samples/couples-spa-treatment-rooms-durban.mp4",
    posterKey: "media/samples/couples-spa-treatment-rooms-durban.webp",
  },
  {
    slug: "custom-headboard-and-pedestals-richards-bay",
    area: "business",
    category: "home_living",
    title: "Custom upholstered headboard and pedestals",
    description:
      "A custom-made upholstered headboard with a matching pair of bedside pedestals, filmed in a furniture store. The video shows the panel stitching and the drawer finish.",
    province: "KwaZulu-Natal",
    city: "Richards Bay",
    videoKey: "media/samples/custom-headboard-and-pedestals-richards-bay.mp4",
    posterKey: "media/samples/custom-headboard-and-pedestals-richards-bay.webp",
  },
  {
    slug: "decorated-venue-for-a-birthday-dinner",
    area: "business",
    category: "events_entertainment",
    title: "Decorated venue for a 50th birthday dinner",
    description:
      "A venue decorated for a 50th birthday dinner, with chandeliers, blue lighting, a stage backdrop and long dressed tables.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/decorated-venue-for-a-birthday-dinner.mp4",
    posterKey: "media/samples/decorated-venue-for-a-birthday-dinner.webp",
  },
  {
    slug: "evening-dining-by-a-koi-pond-fourways",
    area: "business",
    category: "food_dining",
    title: "Evening dining by a koi pond with live saxophone",
    description:
      "An evening visit to a restaurant with a koi pond, a sushi counter and live saxophone music.",
    province: "Gauteng",
    city: "Fourways",
    videoKey: "media/samples/evening-dining-by-a-koi-pond-fourways.mp4",
    posterKey: "media/samples/evening-dining-by-a-koi-pond-fourways.webp",
  },
  {
    slug: "event-equipment-hire-shop-richards-bay",
    area: "business",
    category: "events_entertainment",
    title: "Event equipment shop: tents, chairs and poles",
    description:
      "A customer visits an event equipment shop stocked with tents, chairs and poles, ending at the shop sign.",
    province: "KwaZulu-Natal",
    city: "Richards Bay",
    videoKey: "media/samples/event-equipment-hire-shop-richards-bay.mp4",
    posterKey: "media/samples/event-equipment-hire-shop-richards-bay.webp",
  },
  {
    slug: "family-restaurant-by-the-dam-hartbeespoort",
    area: "business",
    category: "food_dining",
    title: "Family restaurant by the dam",
    description:
      "A family restaurant on an estate by the dam, with indoor lounge seating, garden tables, fish and chips and live music outside.",
    province: "North West",
    city: "Hartbeespoort",
    videoKey: "media/samples/family-restaurant-by-the-dam-hartbeespoort.mp4",
    posterKey: "media/samples/family-restaurant-by-the-dam-hartbeespoort.webp",
  },
  {
    slug: "furniture-and-kitchen-unit-store-midrand",
    area: "business",
    category: "home_living",
    title: "Furniture and kitchen unit store walk-through",
    description:
      "A walk through a large furniture store showing kitchen units, wardrobes, cabinets and lounge suites on the shop floor.",
    province: "Gauteng",
    city: "Midrand",
    videoKey: "media/samples/furniture-and-kitchen-unit-store-midrand.mp4",
    posterKey: "media/samples/furniture-and-kitchen-unit-store-midrand.webp",
  },
  {
    slug: "lakeside-beach-bar-and-seafood",
    area: "business",
    category: "food_dining",
    title: "Lakeside beach bar deck and seafood platter",
    description:
      "A lakeside bar with a wooden walkway, shaded deck seating and views over the water, plus a seafood platter.",
    province: "North West",
    city: "North West",
    videoKey: "media/samples/lakeside-beach-bar-and-seafood.mp4",
    posterKey: "media/samples/lakeside-beach-bar-and-seafood.webp",
  },
  {
    slug: "marquee-and-wedding-table-decor-richards-bay",
    area: "business",
    category: "events_entertainment",
    title: "Marquee tent and wedding table décor",
    description:
      "A clear-roof marquee set up with long tables, white flowers, glassware and gold-rimmed plates. The caption lists Richards Bay, Ulundi, Eshowe, Nkandla and Mandeni as service areas.",
    province: "KwaZulu-Natal",
    city: "Richards Bay",
    videoKey: "media/samples/marquee-and-wedding-table-decor-richards-bay.mp4",
    posterKey: "media/samples/marquee-and-wedding-table-decor-richards-bay.webp",
  },
  {
    slug: "mobile-car-interior-detailing-richards-bay",
    area: "business",
    category: "automotive_services",
    title: "Mobile car interior and roof-lining clean",
    description:
      "A mobile car detailer deep-cleans a vehicle interior, including the roof lining, sun visors and wheels, showing the before and after.",
    province: "KwaZulu-Natal",
    city: "Richards Bay",
    videoKey: "media/samples/mobile-car-interior-detailing-richards-bay.mp4",
    posterKey: "media/samples/mobile-car-interior-detailing-richards-bay.webp",
  },
  {
    slug: "one-kilogram-burger-challenge",
    area: "business",
    category: "food_dining",
    title: "One-kilogram burger challenge at a grill restaurant",
    description:
      "A food creator takes on a burger stacked with more than a kilogram of meat at a grill restaurant.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/one-kilogram-burger-challenge.mp4",
    posterKey: "media/samples/one-kilogram-burger-challenge.webp",
  },
  {
    slug: "perfume-shop-directions-richards-bay",
    area: "business",
    category: "beauty_personal",
    title: "Directions to a perfume shop at a shopping centre",
    description:
      "A short walk from the shopping centre car park to a perfume shop, answering a follower who asked where the store is.",
    province: "KwaZulu-Natal",
    city: "Richards Bay",
    videoKey: "media/samples/perfume-shop-directions-richards-bay.mp4",
    posterKey: "media/samples/perfume-shop-directions-richards-bay.webp",
  },
  {
    slug: "restaurant-in-a-park-sandton",
    area: "business",
    category: "food_dining",
    title: "Restaurant in a park with garden seating",
    description:
      "A restaurant in a park with an outdoor terrace, a burger and steak plate, a cocktail and gardens.",
    province: "Gauteng",
    city: "Sandton",
    videoKey: "media/samples/restaurant-in-a-park-sandton.mp4",
    posterKey: "media/samples/restaurant-in-a-park-sandton.webp",
  },
  {
    slug: "restaurant-interior-and-plated-meals-johannesburg",
    area: "business",
    category: "food_dining",
    title: "Restaurant interior and plated meals",
    description:
      "A visit to a restaurant with a styled dining room and bar. The video shows plated chicken and prawn dishes with chips and rice.",
    province: "Gauteng",
    city: "Johannesburg",
    videoKey: "media/samples/restaurant-interior-and-plated-meals-johannesburg.mp4",
    posterKey: "media/samples/restaurant-interior-and-plated-meals-johannesburg.webp",
  },
  {
    slug: "restaurant-weekday-lunch-dishes-and-cocktails",
    area: "business",
    category: "food_dining",
    title: "Restaurant weekday lunch dishes and cocktails",
    description:
      "A visit to a restaurant for its weekday lunch menu: pizza, burgers, glazed chicken with chips, pasta and a layered cocktail.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/restaurant-weekday-lunch-dishes-and-cocktails.mp4",
    posterKey: "media/samples/restaurant-weekday-lunch-dishes-and-cocktails.webp",
  },
  {
    slug: "rug-and-carpet-showroom-randburg",
    area: "business",
    category: "home_living",
    title: "Rug and carpet showroom walk-through",
    description:
      "A walk through a showroom stacked with rugs and carpets in many sizes, textures and patterns. Staff pull out pieces to show the pile and finish up close.",
    province: "Gauteng",
    city: "Randburg",
    videoKey: "media/samples/rug-and-carpet-showroom-randburg.mp4",
    posterKey: "media/samples/rug-and-carpet-showroom-randburg.webp",
  },
  {
    slug: "wedding-venue-decor-set-up-western-cape",
    area: "business",
    category: "events_entertainment",
    title: "Wedding venue décor set-up with mountain views",
    description:
      "A décor team unloads a truck and sets up a glass-walled wedding venue with flowers, candles and table settings, with mountains in the background.",
    province: "Western Cape",
    city: "Western Cape",
    videoKey: "media/samples/wedding-venue-decor-set-up-western-cape.mp4",
    posterKey: "media/samples/wedding-venue-decor-set-up-western-cape.webp",
  },
  {
    slug: "wigs-and-hair-units-richards-bay",
    area: "business",
    category: "beauty_personal",
    title: "Wigs and hair units",
    description:
      "The owner of a hair shop presents ombré wigs and hair units and shows the cap and the finish of each unit.",
    province: "KwaZulu-Natal",
    city: "Richards Bay",
    videoKey: "media/samples/wigs-and-hair-units-richards-bay.mp4",
    posterKey: "media/samples/wigs-and-hair-units-richards-bay.webp",
  },
  {
    slug: "zulu-traditional-attire-for-hire-richards-bay",
    area: "business",
    category: "fashion_accessories",
    title: "Zulu traditional attire for hire",
    description:
      "A man wears full Zulu traditional attire, including a headdress, animal-print cape and beadwork, at an outdoor event.",
    province: "KwaZulu-Natal",
    city: "Richards Bay",
    videoKey: "media/samples/zulu-traditional-attire-for-hire-richards-bay.mp4",
    posterKey: "media/samples/zulu-traditional-attire-for-hire-richards-bay.webp",
  },
  // Tourism & Events: places to stay and experiences
  {
    slug: "bush-lodge-with-plunge-pool-richards-bay",
    area: "tourism",
    category: "lodge_game_lodge",
    title: "Bush lodge with plunge pool and deck",
    description:
      "A tour of a bush lodge for up to five guests, with a plunge pool, a wooden deck and a modern bathroom.",
    province: "KwaZulu-Natal",
    city: "Richards Bay",
    videoKey: "media/samples/bush-lodge-with-plunge-pool-richards-bay.mp4",
    posterKey: "media/samples/bush-lodge-with-plunge-pool-richards-bay.webp",
  },
  {
    slug: "cabin-with-farmland-sunset-view",
    area: "tourism",
    category: "self_catering",
    title: "Cabin with farmland sunset views",
    description: "A cabin with a lounge facing big windows over farmland, filmed as the sun sets.",
    province: "KwaZulu-Natal",
    city: "Richards Bay area",
    videoKey: "media/samples/cabin-with-farmland-sunset-view.mp4",
    posterKey: "media/samples/cabin-with-farmland-sunset-view.webp",
  },
  {
    slug: "hotel-sunday-brunch-buffet-umhlanga",
    area: "tourism",
    category: "hotel_resort",
    title: "Hotel Sunday brunch buffet",
    description:
      "A hotel Sunday brunch with a buffet of salmon bagels, pastries, cakes and fresh juice, served in a dining room with sea views.",
    province: "KwaZulu-Natal",
    city: "Umhlanga",
    videoKey: "media/samples/hotel-sunday-brunch-buffet-umhlanga.mp4",
    posterKey: "media/samples/hotel-sunday-brunch-buffet-umhlanga.webp",
  },
  {
    slug: "mountain-view-glass-cabin",
    area: "tourism",
    category: "self_catering",
    title: "Glass cabin with plunge pool and mountain views",
    description:
      "A glass-walled cabin with a fireplace and plunge pool, looking out over mountains and a dam at sunset.",
    province: "Western Cape",
    city: "Western Cape",
    videoKey: "media/samples/mountain-view-glass-cabin.mp4",
    posterKey: "media/samples/mountain-view-glass-cabin.webp",
  },
  {
    slug: "port-edward-and-oribi-gorge-day-trip",
    area: "tourism",
    category: "tour_operator",
    title: "Day trip to Port Edward and Oribi Gorge",
    description:
      "A tour operator day trip with game viewing at a nature reserve, water activities, the Oribi Gorge suspension bridge and viewpoints.",
    province: "KwaZulu-Natal",
    city: "South Coast",
    videoKey: "media/samples/port-edward-and-oribi-gorge-day-trip.mp4",
    posterKey: "media/samples/port-edward-and-oribi-gorge-day-trip.webp",
  },
  {
    slug: "quad-bikes-horse-riding-and-archery",
    area: "tourism",
    category: "adventure_activities",
    title: "Quad bikes, horse riding and archery outing",
    description:
      "A day out at an adventure venue with quad bikes on dirt tracks, horse riding and archery.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/quad-bikes-horse-riding-and-archery.mp4",
    posterKey: "media/samples/quad-bikes-horse-riding-and-archery.webp",
  },
  {
    slug: "riverside-lodge-pool-breakfast-and-picnic",
    area: "tourism",
    category: "lodge_game_lodge",
    title: "Riverside lodge breakfast by the pool and picnic",
    description:
      "Breakfast by an infinity pool above a river, game grazing nearby and a picnic set-up on the lawn at a riverside lodge.",
    province: "North West",
    city: "Bushveld",
    videoKey: "media/samples/riverside-lodge-pool-breakfast-and-picnic.mp4",
    posterKey: "media/samples/riverside-lodge-pool-breakfast-and-picnic.webp",
  },
  {
    slug: "romantic-room-set-up-esikhawini",
    area: "tourism",
    category: "guest_house_bnb",
    title: "Romantic room set-up for two at a B&B",
    description:
      "A guest arrives at a B&B where a room has been set up for two with roses, a decorated table and a note board.",
    province: "KwaZulu-Natal",
    city: "eSikhawini",
    videoKey: "media/samples/romantic-room-set-up-esikhawini.mp4",
    posterKey: "media/samples/romantic-room-set-up-esikhawini.webp",
  },
  {
    slug: "safari-cabin-stay-near-cape-town",
    area: "tourism",
    category: "safari_wildlife",
    title: "Safari cabin stay with hot tub",
    description:
      "A cabin in a private game reserve with a hot tub, braai and fireplace, plus giraffe sightings and horse riding on the beach.",
    province: "Western Cape",
    city: "Cape Town area",
    videoKey: "media/samples/safari-cabin-stay-near-cape-town.mp4",
    posterKey: "media/samples/safari-cabin-stay-near-cape-town.webp",
  },
  {
    slug: "stone-cottage-with-pool",
    area: "tourism",
    category: "self_catering",
    title: "Stone cottage with pool and mountain views",
    description:
      "A tour of a stone cottage with a bedroom kitchen, a stone bathroom, and a pool that is lit up at night.",
    province: "Western Cape",
    city: "Western Cape",
    videoKey: "media/samples/stone-cottage-with-pool.mp4",
    posterKey: "media/samples/stone-cottage-with-pool.webp",
  },
  {
    slug: "stone-country-cottage-dullstroom",
    area: "tourism",
    category: "self_catering",
    title: "Stone country cottage near a waterfall",
    description:
      "A stone country cottage with a fireplace and a free-standing bath, and a nearby waterfall in the forest.",
    province: "Mpumalanga",
    city: "Dullstroom",
    videoKey: "media/samples/stone-country-cottage-dullstroom.mp4",
    posterKey: "media/samples/stone-country-cottage-dullstroom.webp",
  },
  // Tourism & Events: events
  {
    slug: "club-party-night-crowd",
    area: "event",
    category: "nightlife_party",
    title: "Party night with a packed dance floor",
    description:
      "A packed club dance floor under red lighting, with the crowd singing along and phone torches in the air.",
    province: "Gauteng",
    city: "Gauteng",
    videoKey: "media/samples/club-party-night-crowd.mp4",
    posterKey: "media/samples/club-party-night-crowd.webp",
  },
  {
    slug: "kota-food-and-music-festival-tembisa",
    area: "event",
    category: "food_wine",
    title: "Kota food and music festival",
    description:
      "Poster slides for a kota food and music festival at Esselen Park, showing the artists on the line-up.",
    province: "Gauteng",
    city: "Tembisa",
    videoKey: "media/samples/kota-food-and-music-festival-tembisa.mp4",
    posterKey: "media/samples/kota-food-and-music-festival-tembisa.webp",
  },
  {
    slug: "new-years-day-music-festival-durban",
    area: "event",
    category: "festival_concert",
    title: "New Year's Day music festival line-up",
    description:
      "Poster slides for a New Year's Day music festival at Greyville Racecourse, showing the artists on the line-up.",
    province: "KwaZulu-Natal",
    city: "Durban",
    videoKey: "media/samples/new-years-day-music-festival-durban.mp4",
    posterKey: "media/samples/new-years-day-music-festival-durban.webp",
    eventDate: "2027-01-01",
  },
  {
    slug: "stadium-music-festival-durban",
    area: "event",
    category: "festival_concert",
    title: "Music festival at the stadium precinct",
    description:
      "Highlights from a music festival at the Moses Mabhida Stadium precinct: marquees, a lounge area, a DJ on stage and a large crowd.",
    province: "KwaZulu-Natal",
    city: "Durban",
    videoKey: "media/samples/stadium-music-festival-durban.mp4",
    posterKey: "media/samples/stadium-music-festival-durban.webp",
  },
];

export { SAMPLE_POST_LABEL } from "./label";

/** The name every sample shows on its business line. */
export const SAMPLE_POST_PRESENTER = "VerifyMzansi";
/** The site's own shield, shown as every sample's logo. */
export const SAMPLE_POST_LOGO = "/images/brand-shield-small.png";

/** One switch for all samples; default off. Read at request time on the server. */
export function samplePostsEnabled(env: Record<string, string | undefined> = process.env) {
  return env.SAMPLE_POSTS_ENABLED?.trim().toLowerCase() === "true";
}

/* ── Valid values (kept in step with src/lib/domains/taxonomy/reference.json by tests) ── */

export const SAMPLE_LISTING_CATEGORIES = [
  "property",
  "vehicles",
  "auto_parts",
  "electronics",
  "home_lifestyle",
  "jobs_services",
  "farming_agriculture",
  "baby_kids",
  "clothing_accessories",
  "sports_hobbies",
  "other_items",
] as const;

/** Mzansi Business categories (tourism businesses are their own area). */
export const SAMPLE_BUSINESS_CATEGORIES = [
  "automotive_services",
  "beauty_personal",
  "trade_maintenance",
  "cleaning_garden",
  "fashion_accessories",
  "community_personal",
  "education_training",
  "electronics_tech",
  "events_entertainment",
  "fitness_wellness",
  "home_living",
  "groceries_essentials",
  "health_medical",
  "pets_animals",
  "professional_services",
  "food_dining",
  "transport_storage",
  "general_other",
] as const;

/** Tourism & Hospitality activities: places to stay and experiences. */
export const SAMPLE_TOURISM_ACTIVITIES = [
  "hotel_resort",
  "guest_house_bnb",
  "lodge_game_lodge",
  "backpackers_hostel",
  "self_catering",
  "tour_operator",
  "travel_agency",
  "safari_wildlife",
  "adventure_activities",
  "cultural_heritage",
  "car_rental_tourism",
  "campground_caravan",
  "spa_wellness_retreat",
  "tourist_attraction",
] as const;

export const SAMPLE_EVENT_TYPES = [
  "festival_concert",
  "conference_seminar",
  "market_expo",
  "sports_event",
  "cultural_heritage",
  "food_wine",
  "outdoor_adventure",
  "workshop_masterclass",
  "charity_fundraiser",
  "community_gathering",
  "comedy_theatre",
  "kids_family",
  "nightlife_party",
] as const;

const CATEGORIES_BY_AREA: Record<SamplePostArea, readonly string[]> = {
  market: SAMPLE_LISTING_CATEGORIES,
  business: SAMPLE_BUSINESS_CATEGORIES,
  tourism: SAMPLE_TOURISM_ACTIVITIES,
  event: SAMPLE_EVENT_TYPES,
};

export const SAMPLE_PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
] as const;

/* ── Validation ─────────────────────────────────────────────── */

/** Committed entries come from this file; local ones from the git-ignored preview file. */
export type SamplePostSource = "committed" | "local";

const ENTRY_KEYS = new Set([
  "slug",
  "area",
  "category",
  "title",
  "description",
  "province",
  "city",
  "videoKey",
  "posterKey",
  "eventDate",
  "locationConfirmed",
]);
const SAMPLE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MEDIA_PATTERNS: Record<SamplePostSource, { video: RegExp; poster: RegExp }> = {
  committed: {
    video: /^media\/samples\/[a-z0-9]+(?:-[a-z0-9]+)*\.mp4$/,
    poster: /^media\/samples\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/,
  },
  // A bare file name inside public/sample-posts-local/ (no folders, no "..").
  local: {
    video: /^[A-Za-z0-9_-][A-Za-z0-9 ._-]*\.(?:mp4|webm)$/i,
    poster: /^[A-Za-z0-9_-][A-Za-z0-9 ._-]*\.(?:webp|jpg|jpeg|png)$/i,
  },
};

/** Whether `value` is a well-formed sample slug (3 to 80 characters). */
export function isSampleSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 80 &&
    SAMPLE_SLUG_PATTERN.test(value)
  );
}

export type SamplePostValidation =
  { ok: true; entry: SamplePostEntry } | { ok: false; errors: string[] };

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function checkLength(
  errors: string[],
  field: string,
  value: string | null,
  min: number,
  max: number
) {
  if (value === null || value.length < min || value.length > max) {
    errors.push(`${field} must be ${min} to ${max} characters`);
  }
}

function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 2020 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Checks one entry. Invalid entries are never shown. */
export function validateSamplePost(
  value: unknown,
  source: SamplePostSource = "committed"
): SamplePostValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["entry must be an object"] };
  }
  const raw = value as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of Object.keys(raw)) {
    if (!ENTRY_KEYS.has(key)) errors.push(`unknown field "${key}"`);
  }

  const slug = text(raw.slug);
  if (!isSampleSlug(slug)) {
    errors.push("slug must be 3 to 80 lowercase letters, digits and single hyphens");
  }

  const area = raw.area as SamplePostArea;
  const categories = Object.hasOwn(CATEGORIES_BY_AREA, String(area))
    ? CATEGORIES_BY_AREA[area]
    : null;
  if (!categories) errors.push('area must be "market", "business", "tourism" or "event"');
  const category = text(raw.category);
  if (categories && (!category || !categories.includes(category))) {
    errors.push(`category "${String(raw.category)}" is not valid for area "${area}"`);
  }

  const title = text(raw.title);
  checkLength(errors, "title", title, 5, 100);
  const description = text(raw.description);
  checkLength(errors, "description", description, 20, 5000);
  const city = text(raw.city);
  checkLength(errors, "city", city, 2, 80);
  const province = text(raw.province);
  if (!province || !(SAMPLE_PROVINCES as readonly string[]).includes(province)) {
    errors.push("province must be a South African province name");
  }

  const media = MEDIA_PATTERNS[source];
  const videoKey = text(raw.videoKey);
  const posterKey = text(raw.posterKey);
  if (source === "committed") {
    // One media pair per slug: media/samples/<slug>.mp4 and .webp.
    if (videoKey !== `media/samples/${slug}.mp4` || !media.video.test(videoKey ?? "")) {
      errors.push("videoKey must be media/samples/<slug>.mp4");
    }
    if (posterKey !== `media/samples/${slug}.webp` || !media.poster.test(posterKey ?? "")) {
      errors.push("posterKey must be media/samples/<slug>.webp");
    }
  } else {
    if (!videoKey || !media.video.test(videoKey) || videoKey.includes("..")) {
      errors.push("videoKey must be a .mp4 or .webm file name in public/sample-posts-local/");
    }
    if (!posterKey || !media.poster.test(posterKey) || posterKey.includes("..")) {
      errors.push("posterKey must be an image file name in public/sample-posts-local/");
    }
  }

  let eventDate: string | undefined;
  if (raw.eventDate !== undefined) {
    const value = text(raw.eventDate);
    if (area !== "event") errors.push("eventDate is only for event samples");
    else if (!value || !isCalendarDate(value)) errors.push("eventDate must be a date (YYYY-MM-DD)");
    else eventDate = value;
  }

  if (raw.locationConfirmed !== undefined && typeof raw.locationConfirmed !== "boolean") {
    errors.push("locationConfirmed must be true or false");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    entry: {
      slug: slug!,
      area,
      category: category!,
      title: title!,
      description: description!,
      province: province!,
      city: city!,
      videoKey: videoKey!,
      posterKey: posterKey!,
      ...(eventDate ? { eventDate } : {}),
    },
  };
}

/** Today's date in South Africa (YYYY-MM-DD). */
export function southAfricanToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The event date to show: only while it is today or later in South Africa. */
export function upcomingEventDate(
  entry: Pick<SamplePostEntry, "eventDate">,
  now: Date = new Date()
): string | null {
  return entry.eventDate && entry.eventDate >= southAfricanToday(now) ? entry.eventDate : null;
}

/**
 * True when `/sample/<slug>` may be served in production as far as the code
 * knows: the switch is on and the slug belongs to a valid committed entry.
 * The proxy answers everything else with a real 404 before the page starts
 * streaming, and then checks the staff hide-list.
 */
export function isPublishedSampleSlug(
  slug: string,
  env: Record<string, string | undefined> = process.env,
  catalogue: readonly unknown[] = APPROVED_SAMPLE_POSTS
): boolean {
  if (!samplePostsEnabled(env) || !isSampleSlug(slug)) return false;
  return catalogue.some((value) => {
    const result = validateSamplePost(value, "committed");
    return result.ok && result.entry.slug === slug;
  });
}
