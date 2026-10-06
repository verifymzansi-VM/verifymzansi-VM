export const POST_FIELD_GUIDANCE: Record<string, string> = {
  subcategory:
    "Choose the specific activity that best describes your listing. A guest house offers rooms to visitors; self-catering accommodation has facilities for guests to prepare meals. For businesses, choose your main activity and describe additional products or services in your description.",
  eventType:
    "Choose the main purpose of your event. Festival / Concert: music or performances. Conference / Seminar: talks and networking. Market / Expo / Fair: stalls or exhibitions. Sports Event: matches or competitions. Cultural Event: cultural or heritage celebrations. Food & Wine: tastings and food festivals. Outdoor / Adventure: organised outdoor activities. Workshop / Masterclass: practical learning. Charity / Fundraiser: raising money for a cause. Community Gathering: local get-togethers. Comedy / Theatre / Show: staged entertainment. Kids / Family: activities aimed at children and families. Nightlife / Party: social parties or club events.",
  condition:
    "New means unused. Like new means used with almost no visible wear. Good means working with normal wear. Fair means noticeable wear that you should describe. For parts means the item is not fully working.",
  slug: "We create your profile link from your business name. You only need to change it if you want a different link. Use lowercase letters, numbers and hyphens.",
  bbbeeLevel:
    "Enter the level shown on your current B-BBEE certificate or affidavit. Leave this blank if you do not know; do not guess a level.",
  starRating:
    "Enter an official accommodation grading only if you have one. This is different from guest reviews. Leave it blank if your property is not graded.",
  tgcsaGrading:
    "Tourism Grading Council of South Africa grading is an official assessment, not a customer review score. Only select a grading that your establishment currently holds.",
  cancellationPolicy:
    "Describe the policy your guests actually receive. Free cancellation means they can cancel within your stated conditions without a charge. Non-refundable means payments are not normally returned. Explain deadlines and exceptions in your description.",
  priceRange:
    "Choose an approximate price band. Explain whether your price is per night, per person or per activity in the description so visitors can compare it fairly.",
  recurring:
    "Choose how often this event happens. This describes the schedule; it does not automatically create additional dated events. The dates on this post must describe the occurrence you are advertising.",
  end_date:
    "For a single-day event, leave the end date blank. If you enter an end time, it must be after the start time. Times are South African Standard Time (SAST).",
  bookingUrl:
    "A web address where visitors can request or make a booking. Leave it blank if bookings happen by phone, WhatsApp or email.",
  ticketsUrl:
    "Paste the full web address where people can buy or reserve tickets. Leave this blank if tickets are arranged through your contact details.",
  ageRestriction:
    "Choose an age limit only when it applies to this event. All ages means children may attend; explain supervision requirements in visitor information.",
  tourDifficultyLevel:
    "Easy requires little exertion. Moderate involves sustained activity. Challenging needs good fitness. Expert is for people with relevant experience. Describe any safety or equipment requirements.",
  serviceAreas:
    "The places you travel to for work, such as Soweto or Sandton. Separate places with commas. This does not mean your home address.",
  oem_or_aftermarket:
    "Original equipment (OEM) parts are made by the original manufacturer. Aftermarket parts are replacement parts made by another manufacturer. Leave this blank if you are unsure.",
  property_type:
    "House: a separate dwelling. Apartment / Flat: a home within a larger building. Room: a room within shared accommodation. Land / Plot: land without a home. Commercial: property used for business.",
  listing_intent:
    "For sale means the buyer purchases the property. To rent means the tenant pays to use it. Enter the monthly rent when renting out property.",
  negotiable: "Choose this if you are willing to discuss a different selling price.",
  service_history:
    "Full means every service is recorded, usually in a service book or dealer records. Partial means some services are recorded. None means there are no service records.",
  drive_type:
    "2WD drives two wheels and suits most town driving. 4WD and AWD drive all four wheels for better grip on gravel, mud or sand.",
  engine_capacity_cc:
    "The engine size in cubic centimetres (cc), shown in the vehicle papers. For example, a 1.6-litre engine is 1600 cc.",
  registration_province:
    "The province where the vehicle is currently registered, as shown on its licence disc.",
  mileage_km: "The distance shown on the odometer, in kilometres.",
  network_lock:
    "Locked means the phone only works with one network's SIM card. Unlocked works with any network.",
  activation_lock_clear:
    "Confirms that the previous owner's account (such as Apple ID or Google account) has been removed, so the buyer can set up the device.",
  battery_health_pct:
    "The battery's remaining capacity compared with when it was new, shown in the device's battery settings.",
  part_condition:
    "New means unused. Used means removed from another vehicle but working. Refurbished means repaired or restored to working order.",
  compatible_year_range: "The model years this part fits, for example 2015-2020.",
  furnished: "Choose this if furniture such as beds, a couch and a table is included.",
  erf_size_sqm: "The size of the land (erf or stand) in square metres, as shown on the title deed.",
  levy_zar:
    "The monthly body corporate or homeowners' association levy, if the property is in a complex or estate.",
};

/** Explanations shown beneath a dropdown for the option the owner has selected, keyed by field id. */
export const POST_OPTION_GUIDANCE: Record<string, Record<string, string>> = {
  subcategory: {
    hotel_resort:
      "Rooms with hotel services such as a reception, housekeeping and often a restaurant.",
    guest_house_bnb:
      "A home or small property offering guest rooms, usually with breakfast available.",
    lodge_game_lodge:
      "Accommodation in a natural or wildlife setting, often with game drives or guided activities.",
    backpackers_hostel:
      "Budget accommodation with shared dormitories or private rooms and shared facilities.",
    self_catering:
      "Accommodation where guests have facilities to prepare their own meals, such as a cottage or holiday flat.",
    campground_caravan:
      "Sites where visitors pitch a tent or park a caravan, with shared ablutions.",
    tour_operator: "You guide or organise tours, such as a township, city or wine tour.",
    safari_wildlife: "Game drives, bush walks or other guided wildlife viewing.",
    adventure_activities: "Activities such as hiking, zip-lining, rafting or bungee jumping.",
    cultural_heritage: "A museum, heritage site or cultural village that visitors come to see.",
    tourist_attraction:
      "A place visitors come to see or do, such as a viewpoint, farm attraction or theme park.",
    travel_agency:
      "You book travel, accommodation or tours on behalf of travellers. You do not need to publish accommodation details.",
    car_rental_tourism: "Vehicles hired to visitors for their trip.",
    spa_wellness_retreat: "A stay focused on rest and treatments, such as a spa or yoga retreat.",
  },
  eventType: {
    festival_concert: "Music or live performances, for example a jazz festival or gospel concert.",
    conference_seminar: "Talks, panels and networking, for example a small business seminar.",
    market_expo: "Stalls or exhibitions, for example a craft market or wedding expo.",
    sports_event: "Matches, races or tournaments, for example a fun run or soccer tournament.",
    cultural_heritage: "Cultural or heritage celebrations, for example a Heritage Day celebration.",
    food_wine: "Tastings and food festivals, for example a wine tasting or braai festival.",
    outdoor_adventure:
      "Organised outdoor activities, for example a group hike or mountain bike day.",
    workshop_masterclass: "Practical learning, for example a baking workshop or photography class.",
    charity_fundraiser: "Raising money for a cause, for example a charity golf day.",
    community_gathering: "Local get-togethers, for example a community clean-up or street party.",
    comedy_theatre: "Staged entertainment, for example a comedy show or play.",
    kids_family: "Activities aimed at children and families, for example a holiday fun day.",
    nightlife_party: "Social parties or club events, for example a themed party night.",
  },
  starRating: {
    "": "Not rated means no official grading is shown. Guest reviews are separate and are not affected.",
  },
  condition: {
    new: "Unused, usually still in its packaging.",
    like_new: "Used, with almost no visible wear.",
    good: "Working, with normal signs of use.",
    fair: "Working, with noticeable wear. Describe it in your description.",
    for_parts: "Not fully working. Buyers may use it for repairs or spare parts.",
  },
};
